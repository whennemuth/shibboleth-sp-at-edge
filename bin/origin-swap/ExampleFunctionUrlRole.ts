import { AttachRolePolicyCommand, CreateRoleCommand, DeleteRoleCommand, DetachRolePolicyCommand, GetRoleCommand, IAMClient, ListAttachedRolePoliciesCommand } from "@aws-sdk/client-iam";
import { logHeader } from "../../lib/Util";

export const suffix = 'lambda-execution-role';
/**
 * This class creates disposable IAM roles for Lambda function execution, for testing scenarios..
 *
 * It handles the complete lifecycle of IAM execution roles for Lambda functions,
 * including creation with proper assume role policies, policy attachment for CloudWatch
 * logging permissions, and cleanup operations. It ensures roles are created with minimal
 * required permissions and can be safely deleted when no longer needed.
 */
export class ExampleFunctionUrlRole {
  private iamClient: IAMClient;
  public roleArn: string | undefined;

  constructor(private parms: { roleName: string, region: string }) {
    this.iamClient = new IAMClient({ region: parms.region });
  }

  public async create(): Promise<void> {
    const { roleName } = this.parms;

    logHeader(`Creating IAM Role: ${roleName}`);

    const assumeRolePolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Service: "lambda.amazonaws.com"
          },
          Action: "sts:AssumeRole"
        }
      ]
    };

    const createRoleCommand = new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicyDocument),
      Description: 'Execution role for Lambda function',      
    });

    try {
      const response = await this.iamClient.send(createRoleCommand);
      this.roleArn = response.Role?.Arn;
      console.log(`Created IAM role: ${roleName}`);
    } catch (error: any) {
      if (error.name === 'EntityAlreadyExistsException') {
        // Role already exists, get its ARN
        const getRoleCommand = new GetRoleCommand({ RoleName: roleName });
        const roleResponse = await this.iamClient.send(getRoleCommand);
        this.roleArn = roleResponse.Role?.Arn;
        console.log(`IAM role ${roleName} already exists, using existing role`);
      } else {
        throw error;
      }
    }

    // Attach the AWSLambdaBasicExecutionRole policy
    const attachPolicyCommand = new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
    });

    await this.iamClient.send(attachPolicyCommand);
    console.log(`Attached AWSLambdaBasicExecutionRole policy to ${roleName}`);
  }

  public async delete(): Promise<void> {
    const { roleName:RoleName } = this.parms;

    logHeader(`Deleting IAM Role: ${RoleName}`);

    try {
      // First, list and detach all attached policies
      const listPoliciesCommand = new ListAttachedRolePoliciesCommand({ RoleName });

      const policiesResponse = await this.iamClient.send(listPoliciesCommand);

      if (policiesResponse.AttachedPolicies) {
        for (const policy of policiesResponse.AttachedPolicies) {
          const detachPolicyCommand = new DetachRolePolicyCommand({
            RoleName,
            PolicyArn: policy.PolicyArn!
          });

          await this.iamClient.send(detachPolicyCommand);
          console.log(`Detached policy ${policy.PolicyArn} from role ${RoleName}`);
        }
      }

      // Now delete the role
      const deleteRoleCommand = new DeleteRoleCommand({ RoleName });

      await this.iamClient.send(deleteRoleCommand);
      console.log(`Deleted IAM role: ${RoleName}`);
      // Clear the stored ARN if it matches the deleted role
      if (this.roleArn && this.roleArn.includes(RoleName)) {
        this.roleArn = undefined;
      }

    } catch (error: any) {
      if (error.name === 'NoSuchEntityException') {
        console.log(`IAM role ${RoleName} does not exist, nothing to delete`);
      } else {
        throw error;
      }
    }
  }
}


if(require.main === module) {
  (async () => {
    const role = new ExampleFunctionUrlRole({ 
      roleName: `example-origin-${suffix}`, 
      region: 'us-east-2' 
    });

    await role.create();
    console.log(`Role ARN: ${role.roleArn}`);

    // Uncomment the following line to delete the role
    // await role.delete();
  })();
}