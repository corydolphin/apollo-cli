import {
  loadConfigFromFile,
  findAndLoadConfig,
  SchemaDependency
} from "./config";
import { ListrTask } from "listr";

export function loadConfigStep(
  flags: any,
  defaultEndpoint: boolean = true
): ListrTask {
  const header: any[] = Array.isArray(flags.header)
    ? flags.header
    : [flags.header];
  const task = {
    title: "Loading Apollo config",
    task: async (ctx: any) => {
      if (flags.config) {
        ctx.config = loadConfigFromFile(flags.config, defaultEndpoint);
      } else {
        ctx.config = findAndLoadConfig(process.cwd(), defaultEndpoint);
      }

      if (flags.schema || flags.endpoint) {
        ctx.config.schemas = {
          default: {
            schema: flags.schema,
            endpoint: flags.endpoint && {
              url: flags.endpoint,
              ...(header.length > 0 && {
                headers: header
                  .filter(x => !!x)
                  .map(x => JSON.parse(x))
                  .reduce((a, b) => Object.assign(a, b), {})
              })
            }
          }
        };
      }

      if (flags.queries) {
        ctx.config.documents = [
          {
            schema: "default",
            includes: flags.queries.split("\n"),
            excludes: []
          }
        ];
      }

      if (flags.key) {
        if (Object.keys(ctx.config.schemas).length == 1) {
          (Object.values(ctx.config.schemas)[0] as SchemaDependency).engineKey =
            flags.key;
        }
      }

      if (
        ctx.config.documents.length == 0 &&
        Object.keys(ctx.config.schemas).length == 1
      ) {
        ctx.config.documents.push({
          schema: Object.keys(ctx.config.schemas)[0],
          includes: ["**/*.graphql"],
          excludes: []
        });
      }
    }
  };

  return task;
}
