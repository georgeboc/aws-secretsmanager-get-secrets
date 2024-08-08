import * as core from '@actions/core'
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { STS } from "@aws-sdk/client-sts";
import {
    buildSecretsList,
    isSecretArn,
    getSecretValue,
    injectSecret,
    extractAliasAndSecretIdFromInput,
    SecretValueResponse, isJSONString,
    parseTransformationFunction
} from "./utils";
import { CLEANUP_NAME } from "./constants";

export async function run(): Promise<void> {
    try {
        // Default client region is set by configure-aws-credentials

        const sts = new STS({ region: "af-south-1" });
        const { Credentials: assumedCredentials } = await sts.assumeRole({ RoleArn: "arn:aws:iam::282750940485:role/githubProviderRole", RoleSessionName: "session"});
        const client : SecretsManagerClient = new SecretsManagerClient({region: "af-south-1", customUserAgent: "github-action", credentials: {
            accessKeyId: assumedCredentials.accessKeyId,
            secretAccessKey: assumedCredentials.secretAccessKey,
            sessionToken: assumedCredentials.sessionToken,
          }
        });
	
        const secretConfigInputs: string[] = ["testenc,test"];  //[...new Set(core.getMultilineInput('secret-ids'))];
        const parseJsonSecrets = true; //core.getBooleanInput('parse-json-secrets');
        const nameTransformation = parseTransformationFunction("lowercase"); //core.getInput('name-transformation') | "uppercase");

        // Get final list of secrets to request
        core.info('Building secrets list...');
        const secretIds: string[] = await buildSecretsList(client, secretConfigInputs, nameTransformation);

        // Keep track of secret names that will need to be cleaned from the environment
        let secretsToCleanup = [] as string[];

        core.info('Your secret names may be transformed in order to be valid environment variables (see README). Enable Debug logging in order to view the new environment names.');

        // Get and inject secret values
        for (let secretId of secretIds) {
            //  Optionally let user set an alias, i.e. `ENV_NAME,secret_name`
            let secretAlias: string | undefined = undefined;
            [secretAlias, secretId] = extractAliasAndSecretIdFromInput(secretId, nameTransformation);

            // Retrieves the secret name also, if the value is an ARN
            const isArn = isSecretArn(secretId);

            try {
		const secretValueResponse : SecretValueResponse = await getSecretValue(client, secretId);
                const secretValue = secretValueResponse.secretValue;

                // Catch if blank prefix is specified but no json is parsed to avoid blank environment variable
                if ((secretAlias === '') && !(parseJsonSecrets && isJSONString(secretValue))) {
                    secretAlias = undefined;
                }

                if (secretAlias === undefined) {
                    secretAlias = isArn ? secretValueResponse.name : secretId;
                }

                const injectedSecrets = injectSecret(secretAlias, secretValue, parseJsonSecrets, nameTransformation);
                secretsToCleanup = [...secretsToCleanup, ...injectedSecrets];
            } catch (err) {
                // Fail action for any error
                core.setFailed(`Failed to fetch secret: '${secretId}'. Error: ${err}.`)
            } 
        }

        // Export the names of variables to clean up after completion
        core.exportVariable(CLEANUP_NAME, JSON.stringify(secretsToCleanup));

        core.info("Completed adding secrets.");
    } catch (error) {
        if (error instanceof Error) core.setFailed(error.message)
    }
}



run();
