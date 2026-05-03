export function getRuntime() {
  return {
    ethers: window.ethers ?? null,
    ethereum: window.ethereum ?? null
  };
}
