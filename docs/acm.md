
# Preparing ACM Certificates for Custom Domains hosted in Route 53

You can use the AWS management console or the AWS CLI to request ACM certificates.
There are a few followup steps you must take after requesting the certificate to ensure it is issued and ready for use by the CloudFront distribution created by this stack. The process is as follows:

1. Request the certificate in ACM, making sure to select us-east-1 as the region, and to include the appropriate domain name(s) that you intend to use for the WordPress site (e.g., `wp.example.edu`).
    ```bash
    # Request the certificate and capture the ARN in a variable
    CERT_ARN=$(aws acm request-certificate \
    --domain-name wp.example.edu \
    --validation-method DNS \
    --region <REGION> \
    --query 'CertificateArn' \
    --output text)
    ```


2. After requesting the certificate, ACM will provide you with a CNAME record that you must add to your Route 53 hosted zone to validate ownership of the domain. Use the CLI to retrieve the CNAME record details and format them into a JSON file suitable for use with the `aws route53 change-resource-record-sets` command to add the record to your hosted zone:
    ```bash
    # Wait a moment for the certificate to be processed
    sleep 5

    # Get validation records from ACM and format them for Route 53 into a json file.
    aws acm describe-certificate \
        --certificate-arn "$CERT_ARN" \
        --region us-east-2 \
        --query 'Certificate.DomainValidationOptions[0].ResourceRecord' \
        --output json | jq '{
            Comment: "ACM DNS validation records",
            Changes: [{
                Action: "CREATE",
                ResourceRecordSet: {
                    Name: .Name,
                    Type: .Type,
                    TTL: 300,
                    ResourceRecords: [{Value: .Value}]
                }
            }]
        }' > validation-records.json
    ```

3. Add this CNAME record to the hosted zone. *(Note, the hosted zone can be in a different AWS account than the one where you requested the certificate.)*. After this is done, ACM can validate ownership of the domain and issue the certificate *(certificate status will change from "Pending validation" to "Issued")*
    ```bash
    aws route53 change-resource-record-sets \
      --hosted-zone-id <HOSTED_ZONE_ID> \
      --change-batch file://validation-records.json
    ```

4. After adding the CNAME record, return to ACM and check the status of the certificate. It may take some time for ACM to validate the domain ownership and issue the certificate. Refresh the page periodically until you see that the certificate status has changed to "Issued".