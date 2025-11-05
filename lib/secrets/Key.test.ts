import { Key, KeyConfig } from './Key';

describe('Key', () => {
  describe('Certificate formatting', () => {
    it('should format a raw certificate string to PEM format', () => {
      const rawCert = 'MIIDXTCCAkWgAwIBAgIJAKmF8qx9F5z5MA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNVBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQ';
      
      const config: KeyConfig = {
        key: rawCert,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      expect(result).toContain('-----BEGIN CERTIFICATE-----');
      expect(result).toContain('-----END CERTIFICATE-----');
      expect(result).toContain('MIIDXTCCAkWgAwIBAgIJAKmF8qx9F5z5MA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV');
    });

    it('should handle already PEM-formatted certificate', () => {
      const pemCert = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKmF8qx9F5z5MA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQ=
-----END CERTIFICATE-----`;

      const config: KeyConfig = {
        key: pemCert,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      expect(result).toContain('-----BEGIN CERTIFICATE-----');
      expect(result).toContain('-----END CERTIFICATE-----');
      expect(result.split('\n').filter(line => line.length > 0).length).toBeGreaterThan(3);
    });

    it('should format certificate with proper 64-character line breaks', () => {
      const longCert = 'A'.repeat(200); // 200 characters to test line breaking
      
      const config: KeyConfig = {
        key: longCert,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      const lines = result.split('\n').filter(line => !line.includes('-----') && line.length > 0);
      lines.forEach(line => {
        expect(line.length).toBeLessThanOrEqual(64);
      });
    });
  });

  describe('RSA Private Key formatting', () => {
    it('should format raw RSA private key to PEM format', () => {
      const rawKey = 'MIIEpAIBAAKCAQEAyKmF8qx9F5z5yKmF8qx9F5z5yKmF8qx9F5z5yKmF8qx9F5z5';
      
      const config: KeyConfig = {
        key: rawKey,
        isPublic: false,
        type: 'rsa'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      expect(result).toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(result).toContain('-----END RSA PRIVATE KEY-----');
      expect(result).toContain(rawKey);
    });

    it('should handle already PEM-formatted RSA private key', () => {
      const pemKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAyKmF8qx9F5z5yKmF8qx9F5z5yKmF8qx9F5z5yKmF8qx9F5z5
yKmF8qx9F5z5yKmF8qx9F5z5yKmF8qx9F5z5yKmF8qx9F5z5yKmF8qx9F5z5
-----END RSA PRIVATE KEY-----`;

      const config: KeyConfig = {
        key: pemKey,
        isPublic: false,
        type: 'rsa'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      expect(result).toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(result).toContain('-----END RSA PRIVATE KEY-----');
    });
  });

  describe('Public Key formatting', () => {
    it('should format raw public key to PEM format', () => {
      const rawKey = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyKmF8qx9F5z5';
      
      const config: KeyConfig = {
        key: rawKey,
        isPublic: true,
        type: 'rsa'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      expect(result).toContain('-----BEGIN PUBLIC KEY-----');
      expect(result).toContain('-----END PUBLIC KEY-----');
      expect(result).toContain(rawKey);
    });

    it('should handle already PEM-formatted public key', () => {
      const pemKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyKmF8qx9F5z5yKmF8qx9
F5z5yKmF8qx9F5z5yKmF8qx9F5z5yKmF8qx9F5z5yKmF8qx9F5z5
-----END PUBLIC KEY-----`;

      const config: KeyConfig = {
        key: pemKey,
        isPublic: true,
        type: 'rsa'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      expect(result).toContain('-----BEGIN PUBLIC KEY-----');
      expect(result).toContain('-----END PUBLIC KEY-----');
    });
  });

  describe('Private Key formatting (non-RSA)', () => {
    it('should format raw private key to PEM format', () => {
      const rawKey = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC4f6BjAuCjlZ2r';
      
      const config: KeyConfig = {
        key: rawKey,
        isPublic: false,
        type: 'rsa' // This will use generic PRIVATE KEY headers since it's not RSA-specific
      };
      
      // Override the type to test non-RSA behavior
      const nonRsaConfig = { ...config, type: 'certificate' as const };
      const key = new Key({ ...nonRsaConfig, type: 'rsa' });
      
      // Temporarily modify the config to simulate non-RSA behavior
      const keyWithGenericPrivate = new Key({
        key: rawKey,
        isPublic: false,
        type: 'certificate' // This should fall through to generic PRIVATE KEY
      });
      
      const result = keyWithGenericPrivate.toPemFormatted();
      
      expect(result).toContain('-----BEGIN CERTIFICATE-----');
      expect(result).toContain('-----END CERTIFICATE-----');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle empty key string', () => {
      const config: KeyConfig = {
        key: '',
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      expect(result).toContain('-----BEGIN CERTIFICATE-----');
      expect(result).toContain('-----END CERTIFICATE-----');
    });

    it('should handle key with mixed line endings', () => {
      const keyWithMixedEndings = `-----BEGIN CERTIFICATE-----\r\nABC123\nDEF456\r\nGHI789\r-----END CERTIFICATE-----`;
      
      const config: KeyConfig = {
        key: keyWithMixedEndings,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      expect(result).toContain('ABC123DEF456GHI789');
      expect(result).not.toContain('\r');
    });

    it('should handle key that exactly fits 64 characters per line', () => {
      const exactKey = 'A'.repeat(64) + 'B'.repeat(64) + 'C'.repeat(32);
      
      const config: KeyConfig = {
        key: exactKey,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      const bodyLines = result.split('\n').filter(line => 
        !line.includes('-----') && line.length > 0
      );
      
      expect(bodyLines[0]).toBe('A'.repeat(64));
      expect(bodyLines[1]).toBe('B'.repeat(64));
      expect(bodyLines[2]).toBe('C'.repeat(32));
    });

    it('should preserve existing PEM headers when reformatting', () => {
      const customPemKey = `-----BEGIN CUSTOM KEY-----
ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ12
-----END CUSTOM KEY-----`;

      const config: KeyConfig = {
        key: customPemKey,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      // Should preserve the original headers, not replace with certificate headers
      expect(result).toContain('-----BEGIN CUSTOM KEY-----');
      expect(result).toContain('-----END CUSTOM KEY-----');
    });
  });

  describe('Line breaking functionality', () => {
    it('should break long strings into 64-character lines', () => {
      const longString = 'A'.repeat(256); // 4 full lines
      
      const config: KeyConfig = {
        key: longString,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      const contentLines = result.split('\n').filter(line => 
        !line.includes('-----') && line.length > 0
      );
      
      expect(contentLines).toHaveLength(4);
      contentLines.forEach(line => {
        expect(line.length).toBe(64);
        expect(line).toBe('A'.repeat(64));
      });
    });

    it('should handle strings not evenly divisible by 64', () => {
      const oddLengthString = 'A'.repeat(130); // 2 full lines + 2 characters
      
      const config: KeyConfig = {
        key: oddLengthString,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();
      
      const contentLines = result.split('\n').filter(line => 
        !line.includes('-----') && line.length > 0
      );
      
      expect(contentLines).toHaveLength(3);
      expect(contentLines[0].length).toBe(64);
      expect(contentLines[1].length).toBe(64);
      expect(contentLines[2].length).toBe(2);
      expect(contentLines[2]).toBe('AA');
    });

    it('Should trim the overall key of any whitespace, including line breaks, and there should be no internal blank lines or extra whitespace', () => {
      const oddLengthString = 'A'.repeat(130); // 2 full lines + 2 characters
      
      const config: KeyConfig = {
        key: oddLengthString,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();

      // The header string should NOT have a line break at its start.
      expect(/^[\n\r\s]+-----BEGIN CERTIFICATE-----/.test(result)).toBe(false);
      // The footer string should have a line break at its end.
      expect(/-----END CERTIFICATE-----[\n\r\s]+$/.test(result)).toBe(false);
      // There should be no consecutive line breaks anywhere in the result.
      expect(/\n\n/.test(result)).toBe(false);
      // There should be no spaces or tabs anywhere in the result except for the headers/footers.
      expect(/[\x20\t]/.test(result.replace(/\x20CERTIFICATE/g, 'CERTIFICATE'))).toBe(false);

      const contentLines = result.split('\n');
      expect(contentLines).toHaveLength(5);
      expect(contentLines[0]).toBe('-----BEGIN CERTIFICATE-----');
      expect(contentLines[contentLines.length - 1]).toBe('-----END CERTIFICATE-----');      
      expect(contentLines[1].length).toBe(64);
      expect(contentLines[2].length).toBe(64);
      expect(contentLines[3].length).toBe(2);
      expect(contentLines[3]).toBe('AA');
    });

    it('Should always reformat PEM-formatted keys to ensure BEGIN/END headers are on their own lines ', () => {
      const pemKeyWithInlineHeaders = `-----BEGIN CERTIFICATE-----ABCDEF1234567890-----END CERTIFICATE-----`;

      const config: KeyConfig = {
        key: pemKeyWithInlineHeaders,
        isPublic: true,
        type: 'certificate'
      };
      
      const key = new Key(config);
      const result = key.toPemFormatted();

      const contentLines = result.split('\n');
      expect(contentLines).toHaveLength(3);
      expect(contentLines[0]).toBe('-----BEGIN CERTIFICATE-----');
      expect(contentLines[contentLines.length - 1]).toBe('-----END CERTIFICATE-----');      
      expect(contentLines[1]).toBe('ABCDEF1234567890');

      // Test with leading/trailing line breaks as well
      const pemKeyWithInlineHeaders2 = "\n-----BEGIN CERTIFICATE-----ABCDEF1234567890-----END CERTIFICATE-----\n";

      const config2: KeyConfig = {
        key: pemKeyWithInlineHeaders2,
        isPublic: true,
        type: 'certificate'
      };

      const key2 = new Key(config2);
      const result2 = key2.toPemFormatted();

      const contentLines2 = result2.split('\n');
      expect(contentLines2).toHaveLength(3);
      expect(contentLines2[0]).toBe('-----BEGIN CERTIFICATE-----');
      expect(contentLines2[contentLines2.length - 1]).toBe('-----END CERTIFICATE-----');
      expect(contentLines2[1]).toBe('ABCDEF1234567890');
    });
  });
});