import { createRegistryClient } from "@zkpassport/registry"
import { getNumberOfPublicInputs, getProofData, type ProofResult } from "@zkpassport/utils"

const BB_V6_MIN_CIRCUIT_VERSION = [0, 22, 0]

function usesBBv6(circuitVersion: string): boolean {
  const parts = circuitVersion.split("-")[0].split(".").map(Number)
  for (let i = 0; i < BB_V6_MIN_CIRCUIT_VERSION.length; i++) {
    if (parts[i] !== BB_V6_MIN_CIRCUIT_VERSION[i]) return parts[i] > BB_V6_MIN_CIRCUIT_VERSION[i]
  }
  return true
}

async function loadBarretenberg(circuitVersion: string) {
  const { UltraHonkVerifierBackend, Barretenberg } = usesBBv6(circuitVersion)
    ? await import("@aztec-foundation/bb.js")
    : await import("@aztec/bb.js")
  const barretenberg = await Barretenberg.new({ crsPath: "/tmp/.bb-crs" })
  return { barretenberg, verifier: new UltraHonkVerifierBackend(barretenberg as never) }
}

/**
 * Verifies an oprf_auth proof against the verification key the registry lists for the proof's
 * circuit version. The SDK only verifies the proofs of an identity request, so this proof is
 * checked here.
 */
export async function verifyOprfAuthProof(proof: ProofResult, devMode: boolean): Promise<boolean> {
  if (!proof.version || !proof.name || typeof proof.proof !== "string") return false

  const registryClient = createRegistryClient(devMode ? "ethereum_sepolia" : "ethereum")
  const manifest = await registryClient.getCircuitManifest(undefined, { version: proof.version })
  const circuit = await registryClient.getPackagedCircuit(proof.name, manifest, { validate: true })

  const proofData = getProofData(proof.proof, getNumberOfPublicInputs(proof.name, proof.version))
  const { barretenberg, verifier } = await loadBarretenberg(proof.version)
  try {
    return await verifier.verifyProof({
      proof: Buffer.from(proofData.proof.join(""), "hex"),
      publicInputs: proofData.publicInputs,
      verificationKey: new Uint8Array(Buffer.from(circuit.vkey, "base64")),
    })
  } catch {
    // bb throws rather than returning false when a proof is malformed
    return false
  } finally {
    await barretenberg.destroy()
  }
}
