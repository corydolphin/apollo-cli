import "apollo-codegen-core/lib/polyfills";
import { Command, flags } from "@oclif/command";
import { table, styledJSON } from "heroku-cli-util";
import * as Listr from "listr";
import { toPromise, execute } from "apollo-link";
import { print, GraphQLError } from "graphql";

import * as fg from "glob";
import { withGlobalFS } from "apollo-codegen-core/lib/localfs";

import { loadQueryDocuments } from "apollo-codegen-core/lib/loading";

import { engineFlags } from "../../engine-cli";
import { engineLink, getIdFromKey } from "../../engine";
import { gitInfo } from "../../git";
import { VALIDATE_OPERATIONS } from "../../operations/validateOperations";
import { ChangeType } from "../../printer/ast";
import { format } from "../schema/check";
import { ApolloConfig } from "../../config";
import { loadConfigStep } from '../../load-config';

export default class CheckQueries extends Command {
  static description =
    "Checks your GraphQL operations for compatibility with the server. Checks against the published schema in Apollo Engine.";

  static flags = {
    help: flags.help({
      char: "h",
      description: "Show command help"
    }),
    config: flags.string({
      description: "Path to your Apollo config file"
    }),
    queries: flags.string({
      description:
        "Path to your GraphQL queries, can include search tokens like **"
    }),
    json: flags.boolean({
      description: "Output result as JSON"
    }),
    ...engineFlags,

    tagName: flags.string({
      description:
        "Name of the template literal tag used to identify template literals containing GraphQL queries in Javascript/Typescript code",
      default: "gql"
    })
  };

  async run() {
    const { flags } = this.parse(CheckQueries);

    const tasks: Listr = new Listr([
      loadConfigStep((msg) => this.error(msg), flags, true),
      {
        title: "Scanning for GraphQL queries",
        task: async (ctx, task) => {
          const paths = withGlobalFS(() => {
            return (ctx.config as ApolloConfig).operations.flatMap(p =>
              fg.sync(p)
            );
          });

          const operations = loadQueryDocuments(paths, flags.tagName);
          task.title = `Scanning for GraphQL queries (${
            operations.length
          } found)`;
          // XXX send along file information as well
          ctx.operations = operations.map(doc => ({ document: print(doc) }));
        }
      },
      {
        title: "Checking query compatibility with schema",
        task: async ctx => {
          const gitContext = await gitInfo();

          const variables = {
            id: getIdFromKey(ctx.config.engineKey),
            // XXX hardcoded for now
            tag: "current",
            gitContext,
            operations: ctx.operations
          };

          ctx.changes = await toPromise(
            execute(engineLink, {
              query: VALIDATE_OPERATIONS,
              variables,
              context: {
                headers: { ["x-api-key"]: ctx.config.engineKey },
                ...(flags.engine && { uri: flags.engine })
              }
            })
          )
            .then(({ data, errors }) => {
              // XXX better end user error message
              if (errors)
                throw new Error(
                  errors.map(({ message }) => message).join("\n")
                );
              if (!data!.service)
                throw new Error(`No schema found for ${variables.id}`);
              return data!.service.schema.checkOperations;
            })
            .catch(e => {
              if (e.result && e.result.errors) {
                this.error(
                  e.result.errors
                    .map(({ message }: GraphQLError) => message)
                    .join("\n")
                );
              } else {
                this.error(e.message);
              }
            });
        }
      }
    ]);

    return tasks.run().then(async ({ changes }) => {
      const failures = changes.filter(
        ({ type }: { type: ChangeType }) => type === ChangeType.FAILURE
      );
      const exit = failures.length > 0 ? 1 : 0;
      if (flags.json) {
        await styledJSON({ changes });
        // exit with failing status if we have failures
        this.exit(exit);
      }
      if (changes.length === 0) {
        return this.log(
          "\nNo operations have issues with the current schema\n"
        );
      }
      this.log("\n");
      table(changes.map(format), {
        columns: [
          { key: "type", label: "Change" },
          { key: "code", label: "Code" },
          { key: "description", label: "Description" }
        ]
      });
      this.log("\n");
      // exit with failing status if we have failures
      this.exit(exit);
    });
  }
}
