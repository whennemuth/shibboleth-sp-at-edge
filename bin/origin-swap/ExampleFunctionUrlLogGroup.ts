import { CloudWatchLogsClient, CreateLogGroupCommand, PutRetentionPolicyCommand, DeleteLogGroupCommand, DescribeLogStreamsCommand, DeleteLogStreamCommand } from "@aws-sdk/client-cloudwatch-logs";
import { logHeader } from "../../lib/Util";

/**
 * Manages CloudWatch log groups for Lambda function URLs.
 * Handles creation, retention policy setting, and deletion of log groups.
 */
export class ExampleFunctionUrlLogGroup {
  private logsClient: CloudWatchLogsClient;
  private logGroupName: string;

  constructor(private parms: { functionName: string, region: string }) {
    this.logsClient = new CloudWatchLogsClient({ region: this.parms.region });
    this.logGroupName = `/aws/lambda/${this.parms.functionName}`;
  }

  public async create(): Promise<void> {
    const { logGroupName } = this;

    logHeader(`Creating CloudWatch Log Group: ${logGroupName}`);

    // Create the log group
    const createLogGroupCommand = new CreateLogGroupCommand({
      logGroupName: this.logGroupName
    });

    try {
      await this.logsClient.send(createLogGroupCommand);
      console.log(`Created log group: ${this.logGroupName}`);
    } catch (error: any) {
      if (error.name === 'ResourceAlreadyExistsException') {
        console.log(`Log group ${logGroupName} already exists, continuing...`);
      } else {
        throw error;
      }
    }

    // Set retention policy to 7 days
    const putRetentionPolicyCommand = new PutRetentionPolicyCommand({
      logGroupName,
      retentionInDays: 7
    });

    await this.logsClient.send(putRetentionPolicyCommand);
    console.log(`Set retention policy to 7 days for log group: ${logGroupName}`);
  }

  public async delete(): Promise<void> {
    const { logGroupName } = this;

    logHeader(`Deleting CloudWatch Log Group: ${logGroupName}`);

    // First delete all log streams within the log group
    try {
      let nextToken: string | undefined;
      do {
        const describeLogStreamsCommand = new DescribeLogStreamsCommand({
          logGroupName,
          nextToken
        });
        const response = await this.logsClient.send(describeLogStreamsCommand);
        nextToken = response.nextToken;

        if (response.logStreams) {
          for (const logStream of response.logStreams) {
            if (logStream.logStreamName) {
              const deleteLogStreamCommand = new DeleteLogStreamCommand({
                logGroupName,
                logStreamName: logStream.logStreamName
              });
              await this.logsClient.send(deleteLogStreamCommand);
              console.log(`Deleted log stream: ${logStream.logStreamName} in ${logGroupName}`);
            }
          }
        }
      } while (nextToken);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`Log group ${logGroupName} does not exist, nothing to delete`);
        return;
      } else {
        throw error;
      }
    }

    // Now delete the log group
    const deleteLogGroupCommand = new DeleteLogGroupCommand({
      logGroupName
    });

    try {
      await this.logsClient.send(deleteLogGroupCommand);
      console.log(`Deleted log group: ${logGroupName}`);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`Log group ${logGroupName} does not exist, nothing to delete`);
      } else {
        throw error;
      }
    }
  }
}


if (require.main === module) {
  (async () => {
    const logGroup = new ExampleFunctionUrlLogGroup({ 
      functionName: 'test-function', 
      region: 'us-east-2' 
    });

    await logGroup.create();

    // Uncomment the following line to test deletion
    // await logGroup.delete();
  })();
}