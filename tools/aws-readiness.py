"""Read-only AWS identity/credit inspection; never prints keys, tokens or credit IDs."""
import argparse
import datetime as dt
from decimal import Decimal
import json
import os
import re
import subprocess


def call_aws(profile, region, arguments):
    command = ["aws", "--profile", profile, "--region", region, "--no-cli-pager",
               "--cli-connect-timeout", "5", "--cli-read-timeout", "10", *arguments,
               "--output", "json"]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=30,
                                env={**os.environ, "AWS_EC2_METADATA_DISABLED": "true", "AWS_PAGER": ""})
        if result.returncode:
            error = result.stderr.lower()
            category = "credentials_not_configured" if "unable to locate credentials" in error else "access_or_session_unavailable"
            if "invalid choice" in error:
                category = "update_aws_cli_for_billing_get_credits"
            return None, category
        return json.loads(result.stdout), None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None, "cli_or_network_unavailable"


def summarize_credit(credit):
    products = set(credit.get("applicableProductNames", []))
    result = {key: credit.get(key) for key in ["creditStatus", "creditType", "remainingAmount",
              "estimatedAmount", "startDate", "endDate", "exhaustDate"]}
    result["relevantEligibleProducts"] = sorted(products & {
        "Amazon Elastic Compute Cloud", "Amazon Simple Storage Service", "Amazon CloudFront",
        "CloudFront Flat-Rate Plans", "Amazon Virtual Private Cloud", "AWS Data Transfer",
        "AmazonCloudWatch", "AWS Systems Manager", "AWS Certificate Manager", "AWS Budgets", "AWS Backup", "Amazon Lightsail"})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="khushal")
    parser.add_argument("--region", default="ap-south-1")
    parser.add_argument("--credits", action="store_true")
    args = parser.parse_args()
    identity, error = call_aws(args.profile, args.region, ["sts", "get-caller-identity"])
    if error:
        print(json.dumps({"identityVerified": False, "reason": error, "credits": "unknown_not_zero", "mutations": "none"}, indent=2))
        return 2
    account = identity.get("Account", "")
    if not re.fullmatch(r"\d{12}", account):
        raise ValueError("Unexpected account identifier")
    report = {"identityVerified": True, "accountSuffix": account[-4:], "profile": args.profile,
              "principalKind": "root" if identity.get("Arn", "").endswith(":root") else "assumed-role" if ":assumed-role/" in identity.get("Arn", "") else "IAM-user",
              "mutations": "none"}
    report["nonRootIdentity"] = report["principalKind"] != "root"
    exit_code = 0
    if args.credits:
        # Billing is global; 364 days avoids the API's one-year lookback ceiling.
        start = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=364)).strftime("%Y-%m-%dT%H:%M:%SZ")
        data, error = call_aws(args.profile, "us-east-1", ["billing", "get-credits", "--account-id", account, "--start-date", start, "--no-payer-account-flag"])
        if error:
            report.update(credits="unknown_not_zero", creditCheck=error)
            exit_code = 2
        else:
            active = [item for item in data.get("credits", []) if item.get("creditStatus") == "ENABLED"]
            total = sum((Decimal((item.get("estimatedAmount") or {}).get("currencyAmount", "0")) for item in active
                         if (item.get("estimatedAmount") or {}).get("currencyCode") == "USD"), Decimal(0))
            report.update(activeCreditOffers=len(active), activeEstimatedRemainingUSD=str(total),
                          credits=[summarize_credit(item) for item in data.get("credits", [])],
                          creditScope="account-owned credits returned for API lookback; confirm console history and eligibility")
    print(json.dumps(report, indent=2))
    return exit_code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError):
        print('{"identityVerified":false,"reason":"unexpected_response","mutations":"none"}')
        raise SystemExit(2)
