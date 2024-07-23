export MSYS_NO_PATHCONV=1
FUNCTION_NAME="SPFunctionOrigin"
for region in $(aws --output text  ec2 describe-regions | cut -f 4)
do
  region="$(echo $region | grep -P '[a-z0-9\-]+')"
    for loggroup in $(aws \
      --output text logs describe-log-groups \
      --log-group-name "/aws/lambda/us-east-1.$FUNCTION_NAME" \
      --region "$region" \
      --query 'logGroups[].logGroupName')
    do
      if [ -n "$loggroup" ] ; then
        echo $region $loggroup
      else
        echo "No loggroup found in $region"
      fi
    done
done
