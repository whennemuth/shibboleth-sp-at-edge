import {
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  ResourceRecordSet,
  Route53Client,
  HostedZone as SdkHostedZone
} from "@aws-sdk/client-route-53";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { ARecord, ARecordProps, HostedZone, RecordTarget, } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { IContext } from '../context/IContext';
import { getStackName } from "./Util";

export type IRoute53HostedZone = {
  exists: () => Promise<boolean>;
  createARecord: (parms: {
    scope: Construct,
    id: string,
    distribution: Distribution,
    hostedZone: string,
    recordName: string
  }) => void;
  findARecord: (recordName: string) => Promise<{ 
    recordSet: ResourceRecordSet | null, 
    hostedZoneId: string | null,
    createdByThisStack: boolean
  }>;
  recordCreatedByThisStack: (recordName: string, region: string) => Promise<boolean>;
  hostedZone?: SdkHostedZone;
  messages?: string;
  found: boolean;
  getHostedZone: () => Promise<SdkHostedZone|undefined>;
  context: IContext;
}

/**
 * This file contains utilities for working with Route53, including creating A records and 
 * checking for existing hosted zones. The Route53HostedZone class provides a way to check if a 
 * hosted zone exists and retrieve it, while tracking any messages related to the process.
 */
export class Route53HostedZone implements IRoute53HostedZone {
  private _hostedZone: SdkHostedZone | undefined;
  private _messages: Set<string> = new Set();

  constructor(private _context: IContext) {}

  public async exists(): Promise<boolean> {
    if( this._hostedZone ) {
      return true;
    }
    const { REGION: region, ACCOUNT, DNS: { hostedZone: domainName } = {} } = this._context;
    if( ! domainName) {
      this._messages.add(`No hosted zone found in context for account ${ACCOUNT}. Please provide a hosted zone or ensure it is defined in the context file.`);
      return false;
    }

    try {
      const client = new Route53Client({ region });
      const command = new ListHostedZonesCommand({});
      const response = await client.send(command);
      
      if (!response.HostedZones) {
        return false;
      }
      
      // Find hosted zone that matches the domain name
      const normalizedDomain = domainName.endsWith('.') ? domainName : `${domainName}.`;
      const hostedZone = response.HostedZones.find(zone => 
        zone.Name === normalizedDomain
      );

      if( hostedZone ) {
        this._hostedZone = hostedZone;
        return true;
      }
      
      return false;
    } 
    catch (error) {
      this._messages.add(`Error checking for hosted zone ${domainName} in account ${ACCOUNT} and region ${region}: ${error}`);
      return false;
    }
  }

  /**
   * Add an A record to the hosted zone that targets the provided distribution.
   * @param parms 
   */
  public createARecord = (parms: {
    scope: Construct,
    id: string,
    distribution: Distribution,
    hostedZone: string,
    recordName: string
  }) => {

    const { distribution, hostedZone, id, recordName, scope } = parms;
    
    // Create the A record
    const aRecord = new ARecord(scope, id, {
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      zone: HostedZone.fromLookup(scope, `${id}hostedzone`, { domainName: hostedZone }),
      comment: `A Record for distribution: ${distribution.distributionId}`,
      recordName
    } as ARecordProps);
  
    // Create an SSM parameter to track ownership
    const stackName = getStackName(this._context);
    new StringParameter(aRecord, `${id}-ownership`, {
      parameterName: `/route53/arecords/${recordName}`,
      stringValue: stackName,
      description: `Tracks that A record ${recordName} was created by stack ${stackName}`
    });
  }

  /**
   * Find an A record by its name in the specified hosted zone that also has evidence it was created by this stack.
   * @param hostedZoneName 
   * @param recordName 
   * @returns 
   */
  public findARecord = async (recordName: string): Promise<{ 
    recordSet: ResourceRecordSet | null, 
    hostedZoneId: string | null,
    createdByThisStack: boolean 
  }> => {
    try {
      const { 
        _context: { REGION: region, DNS: { hostedZone: hostedZoneName } = {} }, 
        getHostedZone, recordCreatedByThisStack 
      } = this;

      const client = new Route53Client({ region});
  
      // Step 1: Find the hosted zone by name
      const hostedZone = await getHostedZone();
      if (!hostedZone) {
        console.warn(`Hosted zone '${hostedZoneName}' not found`);
        return { recordSet: null, hostedZoneId: null, createdByThisStack: false };
      }
  
      // Step 2: List resource record sets in the hosted zone
      const listRecordsCommand = new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZone.Id,
        StartRecordName: recordName,
        StartRecordType: 'A'
      });
  
      const recordsResponse = await client.send(listRecordsCommand);
      
      if (!recordsResponse.ResourceRecordSets) {
        return { recordSet: null, hostedZoneId: hostedZone.Id || null, createdByThisStack: false };
      }
  
      // Step 3: Find the exact A record match
      const fullRecordName = recordName.endsWith('.') ? recordName : `${recordName}.`;
      const aRecord = recordsResponse.ResourceRecordSets.find(record => 
        record.Name === fullRecordName && 
        record.Type === 'A'
      );
  
      if (!aRecord) {
        return { recordSet: null, hostedZoneId: hostedZone.Id || null, createdByThisStack: false };
      }
  
      // Step 4: Check if this record was created by this stack via SSM parameter
      const createdByThisStack = await recordCreatedByThisStack(recordName, region);
  
      return { 
        recordSet: aRecord, 
        hostedZoneId: hostedZone.Id || null, 
        createdByThisStack 
      };
      
    } 
    catch (error) {
      console.error('Error finding A record:', error);
      throw error;
    }
  };

  /**
   * Check if an A record was created by this stack by looking up the corresponding SSM parameter.
   * @param recordName The name of the A record
   * @param region AWS region
   * @returns true if the record was created by this stack
   */
  public recordCreatedByThisStack = async (recordName: string, region: string): Promise<boolean> => {
    try {
      const ssmClient = new SSMClient({ region });
      const parameterName = `/route53/arecords/${recordName}`;
      
      const command = new GetParameterCommand({ Name: parameterName });
      const response = await ssmClient.send(command);
      
      const stackName = getStackName(this._context);
      return response.Parameter?.Value === stackName;
    } catch (error) {
      // Parameter doesn't exist or other error - assume not created by this stack
      return false;
    }
  };

  public get messages(): string | undefined {
    if( this._messages.size === 0 ) {
      return undefined;
    }
    return Array.from(this._messages).join('\n');
  }

  public getHostedZone = async (): Promise<SdkHostedZone|undefined> => {
    if( this._hostedZone ) {
      return this._hostedZone;
    }
    const exists = await this.exists();
    if( exists ) {
      return this._hostedZone;
    }
    return undefined;
  }

  /**
   * Get the hosted zone. It is assumed the async SDK lookup has already been performed, 
   * so this will just return the stored value.
   */
  public get hostedZone(): SdkHostedZone | undefined {
    return this._hostedZone;
  }

  /**
   * Indicate if the hosted zone was found. It is assumed the async SDK lookup has already 
   * been performed, so this will just check if the stored value is defined.
   */
  public get found(): boolean {
    return this._hostedZone !== undefined;
  }

  public get context(): IContext {
    return this._context;
  }
}



if (require.main === module) {
  (async () => {
    const recordName = 'huron1.cssnprd.warhen.work';
    const ctx = await import('../context/context.json') as unknown as IContext;
    const route53HostedZone = new Route53HostedZone(ctx);

    const result = await route53HostedZone.findARecord(recordName);

    if (result.recordSet) {
      console.log(`A Record found: ${JSON.stringify(result.recordSet, null, 2)}`);
      console.log(`Created by this stack: ${result.createdByThisStack}`);
    } else {
      console.log('A Record not found.');
    }
  })();
}