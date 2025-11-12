import {
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  ResourceRecordSet,
  Route53Client,
  HostedZone as Route53HostedZone
} from "@aws-sdk/client-route-53";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { ARecord, ARecordProps, HostedZone, RecordTarget, } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";
import { getStackName } from "../bin/App";

export type CreateARecordParameters = {
  scope: Construct,
  id: string,
  distribution: Distribution,
  hostedZone: string,
  recordName: string
}

/**
 * Create a breadcrumb to add to the ARecord comment to identify the stack that created the resource.
 * @returns The breadcrumb comment
 */
const getBreadCrumb = ():string => {
  const stackName = getStackName();
  return `CREATED_BY: ${stackName}`;
}

/**
 * Add an A record to the hosted zone that targets the provided distribution.
 * @param parms 
 */
export const createARecord = (parms:CreateARecordParameters) => {
  const { distribution, hostedZone, id, recordName, scope } = parms;
  new ARecord(scope, id, {
    target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    zone: HostedZone.fromLookup(scope, `${id}hostedzone`, { domainName: hostedZone }),
    comment: `A Record for distribution: ${distribution.distributionId} - ${getBreadCrumb()}`,
    recordName
  } as ARecordProps);
}

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

    // Step 4: Check if this record was created by this stack
    const stackName = getStackName();
    const createdByThisStack = aRecord.ResourceRecords?.some(record => 
      record.Value?.includes(getBreadCrumb())
    ) || false;

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