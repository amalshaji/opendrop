import type { ValidationResult, Visibility } from "@opendrop/shared/core";
import type { DeploymentWithVersion } from "@opendrop/shared/db/types";

export function publishResponse(
  namespace: string,
  slug: string,
  visibility: Visibility,
  deployment: DeploymentWithVersion,
  validation: ValidationResult
) {
  return {
    namespace,
    slug,
    visibility,
    url: `/${namespace}/${slug}`,
    versionUrl: `/${namespace}/${slug}?version=${encodeURIComponent(deployment.version.id)}`,
    family: deployment.family,
    version: deployment.version,
    validation
  };
}
