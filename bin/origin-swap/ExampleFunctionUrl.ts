import { LambdaClient, CreateFunctionCommand, CreateFunctionUrlConfigCommand, AddPermissionCommand, DeleteFunctionCommand, DeleteFunctionUrlConfigCommand } from "@aws-sdk/client-lambda";
import { ExampleFunctionUrlLogGroup } from "./ExampleFunctionUrlLogGroup";
import { ExampleFunctionUrlRole, suffix as roleSuffix } from "./ExampleFunctionUrlRole";
import { logHeader } from "../../lib/Util";
import JSZip from 'jszip';

export const suffix = 'function';

/**
 * This class creates a disposable Lambda function with a Function URL and associated resources.
 * The function serves as an origin for CloudFront distributions in testing scenarios.
 * It manages the lifecycle of the Lambda function, its execution role, and log group,
 * ensuring proper creation and cleanup of all resources.
 */
export class ExampleFunctionUrl {
  private functionName: string;
  private functionUrl: string | undefined;
  private lambdaClient: LambdaClient;
  private logGroup: ExampleFunctionUrlLogGroup;
  private role: ExampleFunctionUrlRole;

  constructor(private parms: { id: string, region: string }) {
    this.lambdaClient = new LambdaClient({ region: this.parms.region });

    this.functionName = `${this.parms.id}-${suffix}`;

    this.logGroup = new ExampleFunctionUrlLogGroup({
      region: this.parms.region,
      functionName: this.functionName
    });
    
    this.role = new ExampleFunctionUrlRole({ 
      region: this.parms.region, 
      roleName: `${this.parms.id}-${roleSuffix}` 
    });
  }

  public async create(): Promise<void> {
    const { logGroup, role, createFunction, createFunctionUrl } = this;

    await logGroup.create();

    await role.create();

    // Wait for IAM Propagation of the role
    console.log('Waiting 10 seconds for IAM role propagation...');
    for (let i = 10; i > 0; i--) {
      console.log(`${i} seconds remaining`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await createFunction();
    
    await createFunctionUrl();
  }

  private createFunction = async (): Promise<void> => {
    const { functionName } = this;

    const functionCode = `
exports.handler = async (event) => {
    const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
    console.log(JSON.stringify(event, null, 2));
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'text/html'
        },
        body: "<html><body><h1>Hello from " + functionName + "</h1></body></html>"
    };
};
`;

    // Create zip file containing the function code
    const zip = new JSZip();
    zip.file('index.js', functionCode);
    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });

    logHeader(`Creating Lambda Function and Function URL: ${functionName}`);
    const createFunctionCommand = new CreateFunctionCommand({
      FunctionName: functionName,
      Runtime: 'nodejs18.x',
      Role: this.role.roleArn!, // Use the created role
      Handler: 'index.handler',

      Code: {
        ZipFile: zipBuffer
      },
      Description: 'Origin function for CloudFront distribution example',
    });

    try {
      await this.lambdaClient.send(createFunctionCommand);
      console.log(`Created Lambda function: ${functionName}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'ResourceConflictException') {
        console.log(`Function ${functionName} already exists, continuing...`);
      } else {
        console.log('Error creating function:', error);
        console.log(`Performing cleanup of role and log group due to failure.`);
        await this.role.delete();
        await this.logGroup.delete();
        throw error;
      }
    }
  }

  private createFunctionUrl = async (): Promise<void> => {
    const { functionName } = this;

    // Create function URL
    logHeader(`Creating Function URL for Lambda Function: ${functionName}`);
    const createUrlCommand = new CreateFunctionUrlConfigCommand({
      FunctionName: functionName,
      AuthType: 'NONE' // Allow public access for this example
    });
    const urlResponse = await this.lambdaClient.send(createUrlCommand);
    this.functionUrl = urlResponse.FunctionUrl;

    // Add permission for CloudFront and Lambda to invoke the function URL publicly
    const addPermissionCommand1 = new AddPermissionCommand({
      FunctionName: functionName,
      StatementId: 'PublicUrlInvoke',
      Action: 'lambda:InvokeFunctionUrl',
      // Principal: 'cloudfront.amazonaws.com',
      // Principal: 'lambda.amazonaws.com',
      Principal: '*',
      FunctionUrlAuthType: 'NONE'
    });

    // Add permission for public invoke of the function itself
    const addPermissionCommand2 = new AddPermissionCommand({
      FunctionName: functionName,
      StatementId: 'PublicFunctionInvoke',
      Action: 'lambda:InvokeFunction',
      Principal: '*'
    });

    await this.lambdaClient.send(addPermissionCommand1);
    await this.lambdaClient.send(addPermissionCommand2);

    console.log(`Created function URL: ${this.functionUrl}`);
  }

  private deleteFunction = async (): Promise<void> => {
    const deleteFunctionCommand = new DeleteFunctionCommand({
      FunctionName: this.functionName
    });

    logHeader(`Deleting Lambda Function and Function URL: ${this.functionName}`);

    try {
      await this.lambdaClient.send(deleteFunctionCommand);
      console.log(`Deleted Lambda function: ${this.functionName}`);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`Function ${this.functionName} does not exist, nothing to delete`);
      } else {
        throw error;
      }
    }
  }

  private deleteFunctionUrl = async (): Promise<void> => {
    const { functionName } = this;

    logHeader(`Deleting Function URL for Lambda Function: ${functionName}`);
    const deleteUrlCommand = new DeleteFunctionUrlConfigCommand({
      FunctionName: functionName
    });

    try {
      await this.lambdaClient.send(deleteUrlCommand);
      console.log(`Deleted function URL for ${functionName}`);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`Function URL for ${functionName} does not exist, nothing to delete`);
      } else {
        throw error;
      }
    }
  }

  public async delete(): Promise<void> {
    const { logGroup, role, deleteFunction, deleteFunctionUrl } = this;

    await logGroup.delete();

    await deleteFunctionUrl();

    await deleteFunction();

    await role.delete();
  }

  public getFunctionUrl(): string | undefined {
    return this.functionUrl;
  }
}


if (require.main === module) {
  (async () => {
    const parms = { id: 'example-origin', region: 'us-east-2' };

    await new ExampleFunctionUrl(parms).create();

    // To delete, uncomment the following line
    // await new ExampleFunctionUrl(parms).delete();
  })();
}
