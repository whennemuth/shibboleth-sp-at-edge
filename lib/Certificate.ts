import {
  ACMClient,
  CertificateDetail,
  DescribeCertificateCommand,
  DescribeCertificateResponse
} from '@aws-sdk/client-acm';
import { IContext } from "../context/IContext";

/**
 * Class to validate that a given ACM certificate ARN exists in the specified account and 
 * region. This is used to validate the certificate before attempting to use it in the 
 * CloudFront distribution, which would fail if the certificate does not exist or is not 
 * valid. By validating upfront, we can provide a clearer error message to the user about 
 * what is wrong with the certificate ARN they provided.
 */
export class AcmCertificate {
  private certificate: CertificateDetail | undefined;
  private _messages: Set<string> = new Set();

  private static readonly arnRegex = /^arn:aws:acm:[a-z0-9-]+:\d{12}:certificate\/[a-f0-9-]+$/;

  constructor(private context: IContext) {}

  /**
   * Use the SDK to lookup the certificate. 
   * If it exists, cache the certificate details and return true. If it does not exist, return false.
   * @param certificateArn 
   * @returns 
   */
  public exists = async (): Promise<boolean> => {
    if( this.certificate ) {
      return true;
    }
    const { context: { ACCOUNT, DNS: { certificateARN } = {} }, certificateRegion: region } = this;
    if( ! certificateARN) {
      this._messages.add(`No certificate ARN found in context for account ${ACCOUNT} and region ${region}. Please provide a certificate ARN or ensure it is defined in the context file.`);
      return false;
    }

    try {
      // Use AWS SDK to check if certificate exists
      console.log(`Checking if certificate ${certificateARN} exists in account ${ACCOUNT} and region ${region}...`);
      const acmClient = new ACMClient({ region });
      const command = new DescribeCertificateCommand({ CertificateArn: certificateARN });
      const response: DescribeCertificateResponse = await acmClient.send(command);
      const { CertificateArn } = response.Certificate || {};
      if( ! CertificateArn) {
        this._messages.add(`Certificate ${certificateARN} not found in response from ACM.`);
        return false;
      }
      this._messages.add(`Certificate ${CertificateArn} exists and is valid`);
      this.certificate = response.Certificate;
      return true;
    } 
    catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        this._messages.add(
          `Certificate ${certificateARN} does not exist in region ${region}.`);
      }
      this._messages.add(`Failed to validate certificate ${certificateARN}: ${error.message}`);
      return false;
    }
  }

  public get messages(): string | undefined {
    if( this._messages.size === 0 ) {
      return undefined;
    }
    return Array.from(this._messages).join('\n');
  }

  /**
   * Check if the certificate ARN is in a valid format. 
   * This does not check if the certificate actually exists, just that the ARN is well-formed.
   * @returns true if the ARN is in a valid format, false otherwise
   */
  public get isValidArn(): boolean {
    const { DNS: { certificateARN } = {} } = this.context;
    if( ! AcmCertificate.arnRegex.test(certificateARN!)) {
      this._messages.add(`certificateARN ${certificateARN} is not in the correct format for an ACM certificate ARN`);
      return false;
    }
    return true;
  }

  public get certificateRegion(): string | undefined {
    const { DNS: { certificateARN } = {} } = this.context;
    if( certificateARN ) {
      const parts = certificateARN.split(':');
      if( parts.length > 3 ) {
        return parts[3];
      }
    }
    return undefined;
  }

  /**
   * Check if the certificate is in the us-east-1 region, which is required for CloudFront distributions.
   * This does not check if the certificate actually exists, just that the ARN indicates it is in the correct region.
   * @returns true if the ARN indicates the certificate is in us-east-1, false otherwise
   */
  public get isInUsEast1(): boolean {
    const { DNS: { certificateARN } = {} } = this.context;
    if( certificateARN && certificateARN.includes(':us-east-1:')) {
      return true;
    }
    this._messages.add(`Certificate ${certificateARN} is not in us-east-1 region, which is required for CloudFront distributions.`);
    return false;
  }

  /**
   * Check if the certificate is in the same account as specified in the context. This is important because CloudFront distributions can only use certificates from the same account.
   * This does not check if the certificate actually exists, just that the ARN indicates it is in the correct account.
   * @returns true if the ARN indicates the certificate is in the same account, false otherwise
   */
  public get isInThisAccount(): boolean {
    const { ACCOUNT, DNS: { certificateARN } = {} } = this.context;
    if( certificateARN && certificateARN.includes(`:${ACCOUNT}:`)) {
      return true;
    }
    this._messages.add(`Certificate ${certificateARN} does not appear to be in the same account ${ACCOUNT}. Please ensure the certificate ARN is correct and the certificate exists in the specified account.`);
    return false;
  }

  /**
   * Check if the certificate's domain name reflects the hosted zone domain.
   * @returns 
   */
  public reflectsHostedZoneDomain = async (): Promise<boolean> => {
    const { context: { DNS: { certificateARN, hostedZone } = {} }, exists } = this;
    if( ! exists() ) {
      this._messages.add(`Certificate ${certificateARN} does not exist, so cannot reflect the hosted zone domain.`);
      return false;
    }
    const certDomain = this.certificate?.DomainName;
    if( certDomain && hostedZone && certDomain.includes(hostedZone)) {
      return true;
    }
    this._messages.add(`Certificate ${certificateARN} domain ${certDomain} does not appear to include the hosted zone domain ${hostedZone}. Please ensure the certificate covers the correct domain.`);
    return false;
  }
}


if( require.main === module) {
  (async () => {
    const context = await require('../context/context.json') as IContext;

    const cert = new AcmCertificate(context);
    await cert.exists();
    console.log(cert.messages);
  })();
}