import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  console.log(`Deploying CredentialAnchor from ${deployer.address}...`);

  const credentialAnchor = await ethers.deployContract("CredentialAnchor");
  await credentialAnchor.waitForDeployment();

  const address = await credentialAnchor.getAddress();

  console.log(`CredentialAnchor deployed to ${address}`);
  console.log("");
  console.log("Update frontend/config.js with:");
  console.log(`address: "${address}"`);
  console.log("");
  console.log("The deployer is the initial owner and an authorized issuer.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

