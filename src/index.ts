import { t } from "typy";

//
// Execute a query.
//
export async function miniql(query: any, root: any, context: any): Promise<any> {

    const output: any = {};
    const queryOperationName = Object.keys(query)[0]; //TODO: error check! Only one type!
    const queryOperation = query[queryOperationName];
    const queryOperationResolver = root[queryOperationName];
    if (!queryOperationResolver) {
        throw new Error(createMissingQueryOperationErrorMessage(queryOperationName));
    }

    for (const queryKey of Object.keys(queryOperation)) {
        if (queryKey === "op") {
            continue;
        }

        const entityQuery = queryOperation[queryKey]; //TODO: check this is an object!
        const entityTypeName = entityQuery.from !== undefined ? entityQuery.from : queryKey; //TODO: check "from is a string"

        const resolver = queryOperationResolver[entityTypeName];
        if (!resolver) {
            throw new Error(createMissingResolverErrorMessage(queryOperationName, entityTypeName, queryKey));
        }
        const entity = await resolver(entityQuery.args || {}, context); //TODO: Do these in parallel.
        output[queryKey] = entity;

        if (entityQuery.lookup) {
            //
            // Lookup nested entities.
            //
            for (const nestedEntityKey of Object.keys(entityQuery.lookup)) {
                const lookup = entityQuery.lookup[nestedEntityKey];
                let nestedQueryFieldName: string | undefined;
                let outputFieldName: string;
                if (t(lookup).isObject) {
                    nestedQueryFieldName = lookup.from;
                    outputFieldName = lookup.as || nestedEntityKey;
                }
                else if (lookup === true) {
                    nestedQueryFieldName = nestedEntityKey;
                    outputFieldName = nestedEntityKey;
                }
                else {
                    throw new Error(`Unsupported type for "lookup" field: ${typeof(lookup)}.`);
                }

                if (t(entity).isArray) {
                    await Promise.all(
                        entity.map((singleEntity: any) => {
                            return resolveEntity(nestedQueryFieldName, outputFieldName, singleEntity, queryKey, nestedEntityKey, queryOperationResolver, queryOperationName, context, root)
                        })
                    );
                }
                else {
                    await resolveEntity(nestedQueryFieldName, outputFieldName, entity, queryKey, nestedEntityKey, queryOperationResolver, queryOperationName, context, root);
                }
            }
        }
    }

    return output;
}

//
// Creates an error message for a missing query operation.
//
function createMissingQueryOperationErrorMessage(opName: string): string | undefined {
    return `
Query operation "${opName}" is not supported by the resolver.
You must define a query resolver that looks like this:
    const root = {
        ${opName}: {
            // ... Entity query resolvers go here.
        },

        // ... Other query operations go here.
    };
`;
}

//
// Creates an error message for a missing resolver.
//
function createMissingResolverErrorMessage(opName: any, entityTypeName: any, queryKey: string): string {
    return `
Failed to find resolver for operation "${opName}" for entity "${entityTypeName}" outputting to "${queryKey}".\n
You must define a query resolver that looks like this:
    const root = {
        ${opName}: {
            ${entityTypeName}: async function (args, context) => {
                if (args.something) {
                    // ... Return a single entity that matches 'something'.
                }
                else {
                    // ... Return the set of entities (you probably want to use pagination).
                }
            },

            // ... Other resolvers go here.
        },

        // ... Other query operations go here.
    };
`;
}

//
// Resolve a single entity.
//
async function resolveEntity(nestedQueryFieldName: string | undefined, outputFieldName: string, entity: any, entityKey: string, nestedEntityKey: string, operation: any, opName: any, context: any, root: any): Promise<void> {
    let queryArgs: any;
    if (nestedQueryFieldName) {
        queryArgs = entity[nestedQueryFieldName]; //TODO: just need to execute a map fn here to package the id as "args".
    }
    else {
        const mapFnName = `${entityKey}=>${nestedEntityKey}`;
        const mapFn: (query: any, context: any) => any | undefined = operation[mapFnName];
        if (!mapFn) {
            throw new Error(`Failed to find entity mapping function ${mapFnName} for operation ${opName}`);
        }
        queryArgs = await mapFn({ entity: entity }, context);
    }

    let nestedEntity: any;
    if (t(queryArgs).isArray) {
        nestedEntity = await Promise.all(queryArgs.map((args: any) => lookupEntity(nestedEntityKey, args, root, context)));
    }
    else {
        nestedEntity = await lookupEntity(nestedEntityKey, queryArgs, root, context); //TODO: Do these in parallel.
    }

    if (nestedQueryFieldName) {
        if (outputFieldName !== nestedQueryFieldName) {
            delete entity[nestedQueryFieldName];
        }
    }

    entity[outputFieldName] = nestedEntity;
}

//
// Look up an entity by id.
//
export async function lookupEntity(entityKey: string, queryArgs: any, root: any, context: any) {
    const nestedQuery: any = {
        get: { //TODO: operation type shouldn't be hard coded!
        }
    };
    nestedQuery.get[entityKey] = {
        args: queryArgs,
    };
    const nestedResult = await miniql(nestedQuery, root, context); //TODO: Do these in parallel.
    return nestedResult[entityKey];
}
