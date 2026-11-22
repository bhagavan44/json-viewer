import { APP_VERSION, releaseUrl } from './app-version';

describe('app-version', () => {
  it('reads a semantic version from package.json', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('links to the GitHub release for the current version', () => {
    expect(releaseUrl()).toBe(
      `https://github.com/bhagavan44/json-viewer/releases/tag/v${APP_VERSION}`,
    );
  });

  it('links to the release for a given version', () => {
    expect(releaseUrl('1.2.3')).toBe(
      'https://github.com/bhagavan44/json-viewer/releases/tag/v1.2.3',
    );
  });
});
