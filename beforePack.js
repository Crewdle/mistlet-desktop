const { execSync } = require('child_process');
const path = require('path');

module.exports = async (context) => {
  const datachannelPath = path.join(context.packager.projectDir, 'node_modules', 'node-datachannel');
  const faissPath = path.join(context.packager.projectDir, 'node_modules', 'faiss-node');

  console.log('Running prebuild-install for node-datachannel...');
  try {
    const platform = context.electronPlatformName || 'darwin'; // Default to darwin (macOS) if the platform is not defined
    const arch = context.arch === 1 ? 'x64' : 'arm64'; // Default to x64 if the architecture is not defined

    execSync(`npx prebuild-install -r napi --platform=${platform} --arch=${arch}`, {
      cwd: datachannelPath,
      stdio: 'inherit' // This will output the command's output directly to the terminal
    });
    execSync(`npx prebuild-install -r napi --platform=${platform} --arch=${arch}`, {
      cwd: faissPath,
      stdio: 'inherit' // This will output the command's output directly to the terminal
    });
    console.log('prebuild-install completed successfully.');
  } catch (error) {
    console.error('Error running prebuild-install:', error);
    throw error; // This will stop the build if there is an error
  }
};
