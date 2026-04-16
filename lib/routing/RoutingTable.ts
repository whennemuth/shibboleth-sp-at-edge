import { RemovalPolicy } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { IContext } from '../../context/IContext';

/**
 * DynamoDB table for routing rules.
 * 
 * Schema:
 * - Partition key: path (string) - URL path like /admissions, /cas/biology
 * - Attributes: routingType, targetOrigin, redirectStatus, redirectTarget
 * 
 * The table starts empty. Populate via bin/populate-routing-table.ts script.
 */
export class RoutingTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string, context: IContext) {
    super(scope, id);

    const { STACK_ID, TAGS: { Landscape }, ROUTING } = context;
    const tableName = ROUTING?.tableName || `${STACK_ID}-routing-table-${Landscape}`;

    this.table = new Table(this, 'RoutingTable', {
      tableName,
      partitionKey: { name: 'path', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST, // On-demand pricing
      removalPolicy: RemovalPolicy.DESTROY, // For dev; change to RETAIN for production
      pointInTimeRecovery: true,
    });
  }
}
