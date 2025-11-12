
export type KeyConfig = {
  key: string;
  isPublic: boolean;
  type: 'rsa' | 'certificate'
}

/**
 * Class to handle formatting of keys/certificates into PEM format.
 */
export class Key {
  constructor(private config: KeyConfig) {}

  /**
   * Determine if the key is already in PEM format (at least starts with and ends with PEM headers).
   * @returns true/false
   */
  private isAlreadyPemFormatted = (): boolean => {
    const { key } = this.config;
    return key.includes('-----BEGIN') && key.includes('-----END');
  }

  /**
   * Depending on the key type, obtain the appropriate PEM header and footer.
   * @returns The header and footer strings.
   */
  private getPemHeaderFooter = (): { header: string, footer: string } => {
    const { config: { type, isPublic } } = this;

    let header; let footer;

    if (type === 'certificate') {
      header = '-----BEGIN CERTIFICATE-----';
      footer = '-----END CERTIFICATE-----';
    }

    else if(type === 'rsa' && ! isPublic) {
      header = '-----BEGIN RSA PRIVATE KEY-----';
      footer = '-----END RSA PRIVATE KEY-----';
    }

    else {
      header = isPublic ? '-----BEGIN PUBLIC KEY-----' : '-----BEGIN PRIVATE KEY-----';
      footer = isPublic ? '-----END PUBLIC KEY-----' : '-----END PRIVATE KEY-----';
    }

    return { header, footer };
  }

  /**
   * Format the key as PEM, adding headers/footers and line breaks as necessary.
   * @returns 
   */
  public toPemFormatted = (): string => {
    let { config: { key }, isAlreadyPemFormatted, getPemHeaderFooter } = this;

    key = key.trim();

    let header:string; let footer:string; let keyBody:string;

    // Reformat body to have line breaks every 64 characters
    const breakInto64CharLines = (input:string):string => {
      return input.replace(/(.{64})/g, '$1\n').trim();
    }

    if (isAlreadyPemFormatted()) {
      header = /^-----BEGIN ([^\-]*)-----/.exec(key)?.[0] || '';
      footer = /-----END (.*)-----$/.exec(key)?.[0] || '';
      keyBody = key.replace(header, '').replace(footer, '').replace(/\r?\n|\r/g, '');
      keyBody = breakInto64CharLines(keyBody);
    }
    else {
      ({ header, footer } = getPemHeaderFooter());
      keyBody = breakInto64CharLines(key);
    }

    return `${header}\n${keyBody}\n${footer}`;
  }
}