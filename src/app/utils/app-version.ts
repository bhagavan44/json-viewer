// The version is bumped by release-please from the conventional commits on main (see
// release-please-config.json), so package.json is the single source of truth. Only `version` is
// imported, so the rest of package.json stays out of the bundle.
import { version } from '../../../package.json';

const REPO_URL = 'https://github.com/bhagavan44/json-viewer';

/** The app version from package.json, such as `0.1.0`. */
export const APP_VERSION: string = version;

/** The GitHub release page for a version, such as `.../releases/tag/v0.1.0`. */
export function releaseUrl(v: string = APP_VERSION): string {
  return `${REPO_URL}/releases/tag/v${encodeURIComponent(v)}`;
}
