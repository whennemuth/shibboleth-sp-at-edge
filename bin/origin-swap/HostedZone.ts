import { ChangeResourceRecordSetsCommand, HostedZone, ListHostedZonesCommand, ListResourceRecordSetsCommand, Route53Client } from "@aws-sdk/client-route-53";

/**
 * Tools for managing Route 53 hosted zones and DNS records.
 */
export class HostedZoneTools {
  private route53Client: Route53Client;
  private hostedZone: HostedZone;

  constructor(private parms: { subdomain: string, distributionDomainName: string }) {
    this.route53Client = new Route53Client({ region: 'us-east-1' });
  }

  private load = async (): Promise<void> => {
    const { route53Client, parms: { subdomain } } = this;

    const listCommand = new ListHostedZonesCommand({});
    const listResponse = await route53Client.send(listCommand);

    const matchingZones = listResponse.HostedZones?.filter(zone => 
      (subdomain + '.').endsWith(zone.Name!)
    ) || [];

    if (matchingZones.length === 0) {
      throw new Error(`No hosted zone found for subdomain '${subdomain}'`);
    }

    // If multiple, take the most specific (longest name)
    const mostSpecificZone = matchingZones.reduce((prev, current) => 
      (prev.Name!.length > current.Name!.length) ? prev : current
    );

    this.hostedZone = mostSpecificZone;
  }

  public getHostedZone = async (): Promise<HostedZone> => {
    if (!this.hostedZone) {
      await this.load();
    }
    return this.hostedZone;
  }

  public foundHostedZone = async (): Promise<boolean> => {
    if (!this.hostedZone) {
      await this.load();
    }
    return this.hostedZone !== undefined;
  }

  public recordExists = async (): Promise<boolean> => {
    if(await this.foundHostedZone()) {
      const { route53Client, hostedZone, parms: { subdomain, distributionDomainName } } = this;
      
      const listRecordsCommand = new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZone.Id
      });
      const recordsResponse = await route53Client.send(listRecordsCommand);
      
      const exists = recordsResponse.ResourceRecordSets?.some(record =>
        record.Name === subdomain + '.' &&
        record.Type === 'A' &&
        record.AliasTarget?.DNSName?.includes(distributionDomainName)
      ) || false;
      
      return exists;
    }
    return false;
  }

  public async canCreateRecord(): Promise<boolean> {
    if( ! await this.foundHostedZone()) {
      return false;
    }
    if( await this.recordExists()) {
      return false;
    }
    return true;
  }

  public createRecord = async (): Promise<void> => {
    if(await this.recordExists()) {
      console.log(`Record already exists for ${this.parms.subdomain} pointing to ${this.parms.distributionDomainName}`);
      return;
    }

    const { route53Client, hostedZone, parms: { subdomain, distributionDomainName } } = this;
    
    const changeCommand = new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZone.Id,
      ChangeBatch: {
        Changes: [{
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: subdomain + '.',
            Type: 'A',
            AliasTarget: {
              DNSName: distributionDomainName,
              HostedZoneId: 'Z2FDTNDATAQYW2', // Official CloudFront fixed hosted zone ID
              EvaluateTargetHealth: false
            }
          }
        }]
      }
    });
    
    await route53Client.send(changeCommand);
    console.log(`Created A record for ${subdomain} pointing to ${distributionDomainName}`);
  }

  public deleteRecord = async (): Promise<void> => {
    if( ! await this.recordExists()) {
      console.log(`Record does not exist for ${this.parms.subdomain}, nothing to delete.`);
      return;
    }

    const { route53Client, hostedZone, parms: { subdomain, distributionDomainName } } = this;
    
    const changeCommand = new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZone.Id,
      ChangeBatch: {
        Changes: [{
          Action: 'DELETE',
          ResourceRecordSet: {
            Name: subdomain + '.',
            Type: 'A',
            AliasTarget: {
              DNSName: distributionDomainName,
              HostedZoneId: 'Z2FDTNDATAQYW2', // Official CloudFront fixed hosted zone ID
              EvaluateTargetHealth: false
            }
          }
        }]
      }
    });
    
    await route53Client.send(changeCommand);
    console.log(`Deleted A record for ${subdomain} pointing to ${distributionDomainName}`);
  }
}


if (require.main === module) {
  (async () => {
    const parms = { 
      subdomain: 'wp2.warhen.work', 
      distributionDomainName: 'dep3f5o0ntwtv.cloudfront.net' 
    };
    const hostedZoneTools = new HostedZoneTools(parms);
    if(await hostedZoneTools.foundHostedZone()) {
      const hostedZone = await hostedZoneTools.getHostedZone();
      console.log(`Found hosted zone: ${hostedZone.Name} (ID: ${hostedZone.Id})`);
      if(await hostedZoneTools.recordExists()) {
        console.log(`Record exists for ${parms.subdomain} pointing to ${parms.distributionDomainName}`);
      }
      else {
        console.log('Record does not exist.');
        // await hostedZoneTools.createRecord();
      }
    }
    else {
      console.log('Hosted zone not found.');
    }
  })();
}