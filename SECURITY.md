# Security Policy

## Supported versions

JSON Viewer is deployed continuously from `main`. Only the latest version on `main` receives
security fixes.

## Reporting a vulnerability

Please **don't report security problems in public issues, pull requests or discussions.**

Report them privately through GitHub:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what an attacker could do with it.

You should get a first response within a week. Once the problem is confirmed, a fix will be
prepared and released, and you will be credited in the advisory unless you prefer otherwise.

## Scope

JSON Viewer runs entirely in the browser and has no backend. Issues of particular interest include:

- Cross-site scripting (XSS) through crafted JSON, file names or share links
- A share link (`#s=…`) that runs code, leaks data or reads another document
- Data from one saved file or tab leaking to another site or origin
- *Hide sensitive values* or *Copy link, hiding sensitive values* leaving a value visible that it
  claims to hide
- Vulnerable dependencies that are reachable from the app

Out of scope: problems that require a compromised browser or device, self-XSS that needs the victim
to paste code into the developer console, and missing security headers with no demonstrated impact.
