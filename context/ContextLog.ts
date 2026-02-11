import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { AnyPrincipal, Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Bucket, BucketPolicy } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { IContext } from './IContext';

/**
 * Props for the ContextLog construct
 */
export interface ContextLogProps {
  /** The context configuration to store */
  context: IContext;
  /** The stack name for resource naming */
  stackName: string;
}

/**
 * A construct that stores the deployment context configuration in S3
 * with restricted access for CloudFormation console users.
 *
 * This approach avoids SSM parameter size limits while providing
 * secure access to configuration data.
 */
export class ContextLog extends Construct {
  /** The S3 URL where the context is stored */
  public readonly contextUrl: string;

  constructor(scope: Construct, id: string, props: ContextLogProps) {
    super(scope, id);

    const { context, stackName } = props;

    // Create S3 bucket for storing context configuration
    const contextBucket = new Bucket(this, 'context-config-bucket', {
      bucketName: `${stackName}-context-config-${context.ACCOUNT}-${context.REGION}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false, // Explicitly disable public access
    });

    // Store the context configuration in S3
    const contextJson = JSON.stringify(context, null, 2);
    const contextObjectKey = `context.json`;

    // Add restrictive bucket policy - allow access for all IAM users/roles in the account
    const bucketPolicy = new BucketPolicy(this, 'bucket-policy', {
      bucket: contextBucket,
    });

    bucketPolicy.document.addStatements(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new AnyPrincipal()],
        actions: ['s3:GetObject'],
        resources: [`${contextBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            'aws:PrincipalAccount': context.ACCOUNT,
          },
        },
      })
    );

    // Deploy the context JSON directly to S3
    const bucketDeployment = new BucketDeployment(this, 'config-deployment', {
      sources: [Source.data(contextObjectKey, contextJson)],
      destinationBucket: contextBucket,
      destinationKeyPrefix: '',
      retainOnDelete: false,
    });

    // Set the S3 URL after all resources are created
    this.contextUrl = `s3://${contextBucket.bucketName}/${contextObjectKey}`;
       
    // Output the S3 URL for easy reference
    new CfnOutput(scope, 'ContextConfiguration', {
      value: `aws s3 cp ${this.contextUrl} -`,
      description: 'AWS CLI command to get the context configuration from S3',
      exportName: `${stackName}-context-cli-command`
    });
    
  }
}
