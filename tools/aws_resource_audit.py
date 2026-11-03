"""AWS control-plane audit only. No guest commands, writes, Cost Explorer or data-plane reads."""
import argparse
import base64
import concurrent.futures as futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

PROFILE = "khushal"
ENV = {**os.environ, "AWS_PAGER": "", "AWS_EC2_METADATA_DISABLED": "true", "AWS_MAX_ATTEMPTS": "1"}
ALLOWED = {
    "sts": {"get-caller-identity"},
    "ec2": {"describe-regions", "describe-instances", "describe-volumes", "describe-addresses", "describe-snapshots", "describe-images", "describe-nat-gateways", "describe-vpc-endpoints", "describe-network-interfaces", "describe-security-groups", "describe-instance-attribute"},
    "cloudtrail": {"lookup-events"}, "ssm": {"describe-instance-information"},
    "elbv2": {"describe-load-balancers", "describe-target-groups", "describe-target-health"},
    "elb": {"describe-load-balancers"}, "rds": {"describe-db-instances", "describe-db-clusters"},
    "elasticache": {"describe-cache-clusters"}, "kafka": {"list-clusters-v2"}, "eks": {"list-clusters"},
    "ecs": {"list-clusters"}, "lambda": {"list-functions"}, "logs": {"describe-log-groups"},
    "efs": {"describe-file-systems"}, "backup": {"list-backup-vaults", "list-backup-plans"},
    "lightsail": {"get-instances", "get-disks", "get-instance-snapshots", "get-disk-snapshots", "get-static-ips", "get-relational-databases", "get-container-services"},
    "s3api": {"list-buckets", "get-bucket-location"}, "cloudfront": {"list-distributions"},
    "route53": {"list-hosted-zones", "list-health-checks"}, "budgets": {"describe-budget"},
}


def query(region, service, operation, arguments=()):
    if operation not in ALLOWED.get(service, set()):
        raise ValueError("Operation outside the read-only audit allowlist")
    try:
        result = subprocess.run(["aws", "--profile", PROFILE, "--region", region, service, operation,
                                 *arguments, "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "3", "--cli-read-timeout", "6"],
                                capture_output=True, text=True, env=ENV, timeout=25)
        if result.returncode:
            match = re.search(r"\(([A-Za-z0-9]+)\) when calling", result.stderr)
            return {"auditError": match.group(1) if match else "unavailable_or_unsupported"}
        return json.loads(result.stdout or "{}")
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return {"auditError": "cli_network_or_response_unavailable"}


def selected(row, keys):
    return {key: row[key] for key in keys if key in row}


SPECS = [
    ("ec2", "describe-volumes", "Volumes", ["VolumeId", "Size", "VolumeType", "State", "Encrypted", "Attachments", "Tags", "Iops", "Throughput"]),
    ("ec2", "describe-addresses", "Addresses", ["AllocationId", "AssociationId", "PublicIp", "InstanceId", "Tags"]),
    ("ec2", "describe-snapshots", "Snapshots", ["SnapshotId", "VolumeId", "VolumeSize", "State", "StartTime", "StorageTier", "Encrypted", "Description", "Tags"]),
    ("ec2", "describe-images", "Images", ["ImageId", "Name", "State", "BlockDeviceMappings"]),
    ("ec2", "describe-nat-gateways", "NatGateways", ["NatGatewayId", "State", "Tags"]),
    ("ec2", "describe-vpc-endpoints", "VpcEndpoints", ["VpcEndpointId", "VpcEndpointType", "State", "ServiceName"]),
    ("elbv2", "describe-load-balancers", "LoadBalancers", ["LoadBalancerArn", "LoadBalancerName", "Type", "State", "DNSName"]),
    ("elb", "describe-load-balancers", "LoadBalancerDescriptions", ["LoadBalancerName", "DNSName", "Instances"]),
    ("rds", "describe-db-instances", "DBInstances", ["DBInstanceIdentifier", "DBInstanceClass", "DBInstanceStatus", "Engine", "AllocatedStorage"]),
    ("rds", "describe-db-clusters", "DBClusters", ["DBClusterIdentifier", "Status", "Engine"]),
    ("elasticache", "describe-cache-clusters", "CacheClusters", ["CacheClusterId", "CacheNodeType", "CacheClusterStatus"]),
    ("kafka", "list-clusters-v2", "ClusterInfoList", ["ClusterName", "ClusterType", "State"]),
    ("eks", "list-clusters", "clusters", None),
    ("ecs", "list-clusters", "clusterArns", None),
    ("lambda", "list-functions", "Functions", ["FunctionName", "Runtime", "MemorySize", "LastModified"]),
    ("logs", "describe-log-groups", "logGroups", ["logGroupName", "storedBytes", "retentionInDays"]),
    ("efs", "describe-file-systems", "FileSystems", ["FileSystemId", "Name", "LifeCycleState", "SizeInBytes"]),
    ("backup", "list-backup-vaults", "BackupVaultList", ["BackupVaultName", "NumberOfRecoveryPoints"]),
    ("backup", "list-backup-plans", "BackupPlansList", ["BackupPlanName", "VersionId"]),
    ("lightsail", "get-instances", "instances", ["name", "state", "bundleId", "publicIpAddress", "tags"]),
    ("lightsail", "get-disks", "disks", ["name", "sizeInGb", "state", "isAttached"]),
    ("lightsail", "get-instance-snapshots", "instanceSnapshots", ["name", "state", "sizeInGb", "fromInstanceName"]),
    ("lightsail", "get-disk-snapshots", "diskSnapshots", ["name", "state", "sizeInGb", "fromDiskName"]),
    ("lightsail", "get-static-ips", "staticIps", ["name", "ipAddress", "isAttached", "attachedTo"]),
    ("lightsail", "get-relational-databases", "relationalDatabases", ["name", "state", "relationalDatabaseBundleId"]),
    ("lightsail", "get-container-services", "containerServices", ["containerServiceName", "state", "power", "scale"]),
]


def audit_region(region):
    report = {"region": region, "resources": {}, "coverageErrors": []}
    instances = query(region, "ec2", "describe-instances")
    if "auditError" in instances:
        report["coverageErrors"].append({"operation": "ec2:describe-instances", **instances})
    report["instances"] = [selected(i, ["InstanceId", "InstanceType", "State", "LaunchTime", "ImageId", "KeyName", "Tags", "PublicIpAddress", "PublicDnsName", "PrivateIpAddress", "SecurityGroups", "IamInstanceProfile", "BlockDeviceMappings", "Monitoring", "Placement"])
                           for reservation in instances.get("Reservations", []) for i in reservation.get("Instances", []) if i.get("State", {}).get("Name") != "terminated"]
    for service, operation, key, fields in SPECS:
        args = ("--owner-ids", "self") if operation == "describe-snapshots" else ("--owners", "self") if operation == "describe-images" else ()
        result = query(region, service, operation, args)
        label = f"{service}:{operation}"
        if "auditError" in result:
            report["coverageErrors"].append({"operation": label, **result})
        rows = result.get(key, [])
        if rows:
            report["resources"][label] = [selected(row, fields) if fields else row for row in rows]
    if report["instances"]:
        ids = [row["InstanceId"] for row in report["instances"]]
        info = query(region, "ssm", "describe-instance-information")
        report["ssmManagedInstances"] = [selected(i, ["InstanceId", "PingStatus", "PlatformName", "LastPingDateTime"]) for i in info.get("InstanceInformationList", []) if i.get("InstanceId") in ids]
        groups = sorted({g["GroupId"] for i in report["instances"] for g in i.get("SecurityGroups", [])})
        report["securityGroups"] = query(region, "ec2", "describe-security-groups", ("--group-ids", *groups)).get("SecurityGroups", []) if groups else []
        report["networkInterfaces"] = query(region, "ec2", "describe-network-interfaces", ("--filters", "Name=attachment.instance-id,Values=" + ",".join(ids))).get("NetworkInterfaces", [])
        report["usedImages"] = query(region, "ec2", "describe-images", ("--image-ids", *sorted({i["ImageId"] for i in report["instances"]}))).get("Images", [])
        for instance in report["instances"]:
            iid = instance["InstanceId"]
            events = query(region, "cloudtrail", "lookup-events", ("--lookup-attributes", "AttributeKey=ResourceName,AttributeValue=" + iid, "--max-results", "50", "--no-paginate"))
            trail = []
            for event in events.get("Events", []):
                try:
                    payload = json.loads(event.get("CloudTrailEvent", "{}")); actor = payload.get("userIdentity", {})
                    trail.append({"event": event.get("EventName"), "time": event.get("EventTime"), "actorType": actor.get("type"), "actorName": actor.get("userName") or actor.get("sessionContext", {}).get("sessionIssuer", {}).get("userName")})
                except ValueError:
                    pass
            instance["recentCloudTrail"] = trail
            instance["cloudTrailTruncated"] = bool(events.get("NextToken"))
            attribute = query(region, "ec2", "describe-instance-attribute", ("--instance-id", iid, "--attribute", "userData"))
            raw = base64.b64decode(attribute.get("UserData", {}).get("Value", ""))
            text = raw.decode("utf-8", errors="replace")
            instance["bootstrapSummary"] = {"present": bool(raw), "sha256": hashlib.sha256(raw).hexdigest() if raw else None,
                "knownMarkers": [word for word in ["medipulse", "threatgraph", "bachat", "docker", "nginx", "node", "python", "jenkins", "kubernetes"] if word in text.lower()]}
    return report


def main():
    global PROFILE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="khushal")
    args = parser.parse_args(); PROFILE = args.profile
    identity = query("us-east-1", "sts", "get-caller-identity")
    if "auditError" in identity:
        print(json.dumps({"identityVerified": False, "mutations": "none"})); return 2
    regions = query("us-east-1", "ec2", "describe-regions").get("Regions", [])
    report = {"collectedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(), "mutations": "none", "scope": "Control plane only; no SSH/SSM execution, raw user data, keys, passwords, Cost Explorer, guest files or public-app probes", "regions": []}
    with futures.ThreadPoolExecutor(max_workers=10) as pool:
        jobs = {pool.submit(audit_region, region["RegionName"]): region["RegionName"] for region in regions}
        for job in futures.as_completed(jobs):
            region = jobs[job]
            try:
                entry = job.result(); report["regions"].append(entry)
                print(json.dumps({"regionAudited": region, "instances": len(entry["instances"]), "nonemptyResourceCategories": len(entry["resources"]), "coverageErrors": len(entry["coverageErrors"])}), flush=True)
            except Exception as error:
                report["regions"].append({"region": region, "auditError": type(error).__name__})
    report["global"] = {
        "s3": query("us-east-1", "s3api", "list-buckets"),
        "cloudfront": query("us-east-1", "cloudfront", "list-distributions"),
        "route53Zones": query("us-east-1", "route53", "list-hosted-zones"),
        "route53HealthChecks": query("us-east-1", "route53", "list-health-checks"),
        "budget": query("us-east-1", "budgets", "describe-budget", ("--account-id", identity["Account"], "--budget-name", "MediPulse-AWS-Pilot-Gross-Monthly")),
    }
    private = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "MediPulse" / "Private"
    private.mkdir(parents=True, exist_ok=True)
    target = private / "aws-resource-audit.json"
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"auditFile": str(target), "regionsChecked": len(report["regions"]), "mutations": "none"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
