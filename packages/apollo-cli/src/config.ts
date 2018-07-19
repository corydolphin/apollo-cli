import { basename, dirname, join, relative, resolve } from "path";
import { fs, withGlobalFS } from "apollo-codegen-core/lib/localfs";

import * as fg from "glob";
import * as minimatch from "minimatch";
import { GraphQLSchema, buildClientSchema } from "graphql";
import { loadSchema } from "./load-schema";

export interface EndpointConfig {
  url?: string; // main HTTP endpoint
  subscriptions?: string; // WS endpoint for subscriptions
  headers?: Object; // headers to send when performing operations
}

export interface SchemaDependency {
  schema?: string;
  endpoint?: EndpointConfig;
  engineKey?: string;
}

export interface DocumentSet {
  schema?: string;
  includes: string[];
  excludes: string[];
}

export interface ApolloConfig {
  projectFolder: string;
  projectName?: string;
  schemas?: { [name: string]: SchemaDependency }; // path to JSON introspection, if not provided endpoint will be used
  documents?: DocumentSet[];
  engineKey?: string; // Apollo Engine key
}

function loadEndpointConfig(
  obj: any,
  shouldDefaultURL: boolean
): EndpointConfig | undefined {
  let preSubscriptions: EndpointConfig | undefined;
  if (typeof obj === "string") {
    preSubscriptions = {
      url: obj
    };
  } else {
    preSubscriptions =
      (obj as EndpointConfig | undefined) ||
      (shouldDefaultURL ? { url: "http://localhost:4000/graphql" } : undefined);
  }

  if (
    preSubscriptions &&
    !preSubscriptions.subscriptions &&
    preSubscriptions.url
  ) {
    preSubscriptions.subscriptions = preSubscriptions.url!.replace(
      "http",
      "ws"
    );
  }

  return preSubscriptions;
}

function loadSchemaConfig(
  obj: any,
  defaultEndpoint: boolean
): SchemaDependency {
  return {
    schema: obj.schema,
    endpoint: loadEndpointConfig(
      obj.endpoint,
      !obj.engineKey && defaultEndpoint
    ),
    engineKey: obj.engineKey
  };
}

function loadDocumentSet(obj: any): DocumentSet {
  return {
    schema: obj.schema,
    includes:
      typeof obj.includes === "string"
        ? [obj.includes as string]
        : obj.includes
          ? (obj.includes as string[])
          : ["**/*.graphql"],
    excludes:
      typeof obj.excludes === "string"
        ? [obj.excludes as string]
        : obj.excludes
          ? (obj.excludes as string[])
          : ["node_modules"]
  };
}

export function loadConfig(
  obj: any,
  configDir: string,
  defaultEndpoint: boolean
): ApolloConfig {
  const schemasObj = (obj.schemas || {}) as { [name: string]: any };
  Object.keys(schemasObj).forEach(key => {
    schemasObj[key] = loadSchemaConfig(schemasObj[key], defaultEndpoint);
  });

  if (Object.keys(schemasObj).length == 0) {
    schemasObj["default"] = loadSchemaConfig({}, defaultEndpoint);
  }

  return {
    projectFolder: configDir,
    schemas: schemasObj,
    projectName: basename(configDir),
    documents: (obj.documents
      ? Array.isArray(obj.documents)
        ? (obj.documents as any[])
        : [obj.documents]
      : []
    ).map(d => loadDocumentSet(d))
  };
}

export function loadConfigFromFile(
  file: string,
  defaultEndpoint: boolean
): ApolloConfig {
  if (file.endsWith(".js")) {
    delete require.cache[require.resolve(file)];
    return loadConfig(require(file), dirname(file), defaultEndpoint);
  } else if (file.endsWith("package.json")) {
    const apolloKey = JSON.parse(fs.readFileSync(file).toString()).apollo;
    if (apolloKey) {
      return loadConfig(apolloKey, dirname(file), defaultEndpoint);
    } else {
      return loadConfig({}, dirname(file), defaultEndpoint);
    }
  } else {
    throw new Error("Unsupported config file format");
  }
}

export function findAndLoadConfig(
  dir: string,
  defaultEndpoint: boolean
): ApolloConfig {
  if (fs.existsSync(join(dir, "apollo.config.js"))) {
    return loadConfigFromFile(join(dir, "apollo.config.js"), defaultEndpoint);
  } else if (fs.existsSync(join(dir, "package.json"))) {
    return loadConfigFromFile(join(dir, "package.json"), defaultEndpoint);
  } else {
    return loadConfig({}, dir, defaultEndpoint);
  }
}

export interface ResolvedDocumentSet {
  schema?: GraphQLSchema;
  endpoint?: EndpointConfig;
  engineKey?: string;

  documentPaths: string[];
}

export async function resolveDocumentSets(
  config: ApolloConfig,
  needSchema: boolean
): Promise<ResolvedDocumentSet[]> {
  return await Promise.all(
    (config.documents || []).map(async doc => {
      const referredSchema = doc.schema
        ? (config.schemas || {})[doc.schema]
        : undefined;
      const resolvedSchema =
        referredSchema && needSchema && (await loadSchema(referredSchema));

      return {
        schema: resolvedSchema
          ? buildClientSchema({ __schema: resolvedSchema })
          : undefined,
        endpoint: referredSchema ? referredSchema.endpoint : undefined,
        engineKey: referredSchema ? referredSchema.engineKey : undefined,
        documentPaths: doc.includes
          .flatMap(i =>
            withGlobalFS(() =>
              fg.sync(i, { root: config.projectFolder, absolute: true })
            )
          )
          .filter(
            f =>
              !(
                doc.excludes.some(e =>
                  minimatch(relative(config.projectFolder, f), e)
                ) ||
                (referredSchema &&
                  referredSchema.schema &&
                  f === resolve(config.projectFolder, referredSchema.schema))
              )
          )
      };
    })
  );
}
