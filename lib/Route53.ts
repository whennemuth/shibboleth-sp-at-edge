import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HostedZone, ARecord, ARecordProps, RecordTarget,  } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

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
  new ARecord(scope, id, {
    target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    zone: HostedZone.fromLookup(scope, `${id}hostedzone`, { domainName: hostedZone }),
    comment: `A Record for distribution: ${distribution.distributionId}`,
    recordName
  } as ARecordProps);
}