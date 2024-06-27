require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');

module.exports = async (context) => {
  const installerFile = context.artifactPaths.find((p) => p.endsWith('.exe'));

  if (!installerFile) {
    return;
  }

  const baseDir = path.join(context.outDir, '../KeyLocker');

  console.log('Running signing process for Windows...');
  execSync(`java -jar jsign-5.0.jar --storetype DIGICERTONE --storepass "${process.env.MICROSOFT_CERTIFICATE}" --alias ${process.env.MICROSOFT_CERTIFICATE_ALIAS} "${installerFile}"`, {
    cwd: baseDir,
    stdio: 'inherit'
  });
};
