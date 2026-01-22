import {
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  ResourceRecordSet,
  Route53Client,
  HostedZone as Route53HostedZone
} from "@aws-sdk/client-route-53";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { ARecord, ARecordProps, HostedZone, RecordTarget, } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { IContext } from '../context/IContext';
import * as ctx from '../context/context.json';
import { getStackName } from "./Util";

const context = ctx as IContext;

export type CreateARecordParameters = {
  scope: Construct,
  id: string,
  distribution: Distribution,
  hostedZone: string,
  recordName: string
}

/**
 * Add an A record to the hosted zone that targets the provided distribution.
 * @param parms 
 */
export const createARecord = (parms:CreateARecordParameters) => {
  const { distribution, hostedZone, id, recordName, scope } = parms;
  
  // Create the A record
  const aRecord = new ARecord(scope, id, {
    target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    zone: HostedZone.fromLookup(scope, `${id}hostedzone`, { domainName: hostedZone }),
    comment: `A Record for distribution: ${distribution.distributionId}`,
    recordName
  } as ARecordProps);

  // Create an SSM parameter to track ownership
  const stackName = getStackName(context);
  new StringParameter(aRecord, `${id}-ownership`, {
    parameterName: `/route53/arecords/${recordName}`,
    stringValue: stackName,
    description: `Tracks that A record ${recordName} was created by stack ${stackName}`
  });
}

/**
 * Check if an A record was created by this stack by looking up the corresponding SSM parameter.
 * @param recordName The name of the A record
 * @param region AWS region
 * @returns true if the record was created by this stack
 */
const checkIfCreatedByThisStack = async (recordName: string, region: string): Promise<boolean> => {
  try {
    const ssmClient = new SSMClient({ region });
    const parameterName = `/route53/arecords/${recordName}`;
    
    const command = new GetParameterCommand({ Name: parameterName });
    const response = await ssmClient.send(command);
    
    const stackName = getStackName(context);
    return response.Parameter?.Value === stackName;
  } catch (error) {
    // Parameter doesn't exist or other error - assume not created by this stack
    return false;
  }
};

/**
 * Find an A record by its name in the specified hosted zone that also has evidence it was created by this stack.
 * @param hostedZoneName 
 * @param recordName 
 * @returns 
 */
export const findARecord = async (hostedZoneName: string, recordName: string, region: string): Promise<{ 
  recordSet: ResourceRecordSet | null, 
  hostedZoneId: string | null,
  createdByThisStack: boolean 
}> => {
  try {
    const client = new Route53Client({ region});

    // Step 1: Find the hosted zone by name
    const hostedZone = await findHostedZoneByName(hostedZoneName, region);
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
    const createdByThisStack = await checkIfCreatedByThisStack(recordName, region);

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
 * Find a hosted zone by its domain name
 */
export const findHostedZoneByName = async (domainName: string, region: string): Promise<Route53HostedZone | null> => {
  try {
    const client = new Route53Client({ region });

    const command = new ListHostedZonesCommand({});
    const response = await client.send(command);
    
    if (!response.HostedZones) {
      return null;
    }
    
    // Find hosted zone that matches the domain name
    const normalizedDomain = domainName.endsWith('.') ? domainName : `${domainName}.`;
    const hostedZone = response.HostedZones.find(zone => 
      zone.Name === normalizedDomain
    );
    
    return hostedZone || null;
  } 
  catch (error) {
    console.error('Error finding hosted zone:', error);
    throw error;
  }
};


if (require.main === module) {
  (async () => {
    const hostedZoneName = 'cssnprd.warhen.work';
    const recordName = 'huron1.cssnprd.warhen.work';
    const region = ctx.REGION;

    const result = await findARecord(hostedZoneName, recordName, region);
    if (result.recordSet) {
      console.log(`A Record found: ${JSON.stringify(result.recordSet, null, 2)}`);
      console.log(`Created by this stack: ${result.createdByThisStack}`);
    } else {
      console.log('A Record not found.');
    }
  })();
}