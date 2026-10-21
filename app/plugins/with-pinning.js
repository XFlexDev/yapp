const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, withInfoPlist } = require('expo/config-plugins');

// SPKI SHA-256 of every CA Cloudflare may issue our edge certs from (Let's Encrypt, Google Trust Services, SSL.com).
const PINS = [
  'C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=', // ISRG Root X1
  'diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=', // ISRG Root X2
  'sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=', // ISRG Root YE
  'hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc=', // GTS Root R1
  'QXnt2YHvdHR3tJYmQIr0Paosp6t/nggsEGD4QJZ3Q0g=', // GTS Root R3
  'mEflZT5enoR1FuXLgYYGqnVEoZvmf9c2bVBpiOjYQ0c=', // GTS Root R4
  'CLOmM1/OXvSPjw5UOYbAf9GKOxImEp9hhku9W90fHMk=', // GlobalSign ECC Root R4
  'cGuxAXyFXFkWm61cF4HPWX8S0srS9j0aSqN0k4AP+4A=', // GlobalSign Root R3
  'G/ANXI8TwJTdF+AFBM8IiIUPEv0Gf6H5LA/b9guG4yE=', // SSL.com TLS ECC Root 2022
  'K89VOmb1cJAN3TK6bf4ezAbJGC1mLcG2Dh97dnwr3VQ=', // SSL.com TLS RSA Root 2022
  'oyD01TTXvpfBro3QSZc1vIlcMjrdLTiL/M9mLCPX+Zo=', // SSL.com Root ECC
  '0cRTd+vc1hjNFlHcLgLCHXUeWqn80bNDH/bs9qMTSPo=', // SSL.com Root RSA
];
const DOMAIN = 'kreatix.dev';
const EXPIRES = '2029-01-01';

const xml = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="true">${DOMAIN}</domain>
    <trust-anchors><certificates src="system" /></trust-anchors>
    <pin-set expiration="${EXPIRES}">
${PINS.map((p) => `      <pin digest="SHA-256">${p}</pin>`).join('\n')}
    </pin-set>
  </domain-config>
</network-security-config>
`;

module.exports = function withPinning(config) {
  config = withDangerousMod(config, ['android', (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'network_security_config.xml'), xml);
    return c;
  }]);
  config = withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return c;
  });
  config = withInfoPlist(config, (c) => {
    const ats = c.modResults.NSAppTransportSecurity ?? {};
    ats.NSPinnedDomains = {
      ...(ats.NSPinnedDomains ?? {}),
      [DOMAIN]: { NSIncludesSubdomains: true, NSPinnedCAIdentities: PINS.map((p) => ({ 'SPKI-SHA256-BASE64': p })) },
    };
    c.modResults.NSAppTransportSecurity = ats;
    return c;
  });
  return config;
};
