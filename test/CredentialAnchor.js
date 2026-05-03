import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("CredentialAnchor", function () {
  const ROOT_A = ethers.keccak256(ethers.toUtf8Bytes("root-a"));
  const ROOT_B = ethers.keccak256(ethers.toUtf8Bytes("root-b"));
  const BATCH_A = "spring-2026-cohort-a";
  const BATCH_B = "spring-2026-cohort-b";

  async function deployFixture() {
    const [owner, issuer, outsider] = await ethers.getSigners();
    const contract = await ethers.deployContract("CredentialAnchor");
    await contract.waitForDeployment();

    return { contract, owner, issuer, outsider };
  }

  it("authorizes the deployer as owner and issuer", async function () {
    const { contract, owner } = await deployFixture();

    assert.equal(await contract.owner(), owner.address);
    assert.equal(await contract.isAuthorizedIssuer(owner.address), true);
  });

  it("lets the owner authorize another issuer", async function () {
    const { contract, issuer } = await deployFixture();

    await contract.setIssuerAuthorization(issuer.address, true);

    assert.equal(await contract.isAuthorizedIssuer(issuer.address), true);
  });

  it("rejects anchoring from an unauthorized issuer", async function () {
    const { contract, issuer } = await deployFixture();

    await assert.rejects(
      contract.connect(issuer).anchorRoot(ROOT_A, BATCH_A),
      /NotAuthorizedIssuer/
    );
  });

  it("anchors a root and stores compact metadata", async function () {
    const { contract, issuer } = await deployFixture();

    await contract.setIssuerAuthorization(issuer.address, true);
    await contract.connect(issuer).anchorRoot(ROOT_A, BATCH_A);

    const record = await contract.getRootRecord(ROOT_A);

    assert.equal(record.issuer, issuer.address);
    assert.equal(record.revoked, false);
    assert.equal(record.revokedAt, 0n);
    assert.ok(record.anchoredAt > 0n);
    assert.equal(await contract.getBatchRoot(BATCH_A), ROOT_A);
    assert.equal(await contract.isRootActive(ROOT_A), true);
  });

  it("rejects duplicate roots and duplicate batch identifiers", async function () {
    const { contract } = await deployFixture();

    await contract.anchorRoot(ROOT_A, BATCH_A);

    await assert.rejects(
      contract.anchorRoot(ROOT_A, BATCH_B),
      /RootAlreadyAnchored/
    );
    await assert.rejects(
      contract.anchorRoot(ROOT_B, BATCH_A),
      /BatchIdAlreadyUsed/
    );
  });

  it("lets the original issuer revoke an anchored root", async function () {
    const { contract, issuer } = await deployFixture();

    await contract.setIssuerAuthorization(issuer.address, true);
    await contract.connect(issuer).anchorRoot(ROOT_A, BATCH_A);
    await contract.connect(issuer).revokeRoot(ROOT_A);

    const record = await contract.getRootRecord(ROOT_A);

    assert.equal(record.revoked, true);
    assert.ok(record.revokedAt > 0n);
    assert.equal(await contract.isRootActive(ROOT_A), false);
  });

  it("lets the owner revoke another issuer's root", async function () {
    const { contract, issuer } = await deployFixture();

    await contract.setIssuerAuthorization(issuer.address, true);
    await contract.connect(issuer).anchorRoot(ROOT_A, BATCH_A);
    await contract.revokeRoot(ROOT_A);

    assert.equal(await contract.isRootActive(ROOT_A), false);
  });

  it("rejects revocation from unrelated accounts", async function () {
    const { contract, issuer, outsider } = await deployFixture();

    await contract.setIssuerAuthorization(issuer.address, true);
    await contract.connect(issuer).anchorRoot(ROOT_A, BATCH_A);

    await assert.rejects(
      contract.connect(outsider).revokeRoot(ROOT_A),
      /RevocationNotAllowed/
    );
  });
});

