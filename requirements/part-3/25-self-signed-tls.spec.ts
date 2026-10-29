/**
 * REQUIREMENTS_3.md: "Self signed TLS certificate is configured."
 */

import { connect, type PeerCertificate } from "node:tls"
import { expect, test } from "@playwright/test"

/** What the stack's TLS handshake shows: its certificate, and why Node's trusted authorities do not vouch for it. */
const handshakeWith = (url: URL): Promise<{ certificate: PeerCertificate; authorizationError: string; protocol: string }> =>
  new Promise((resolve, reject) => {
    const socket = connect(
      { host: url.hostname, port: Number(url.port || 443), servername: "localhost", rejectUnauthorized: false },
      () => {
        resolve({
          certificate: socket.getPeerCertificate(),
          authorizationError: String(socket.authorizationError),
          protocol: socket.getProtocol() ?? "",
        })
        socket.end()
      },
    )

    socket.on("error", reject)
  })

test("the storefront answers over TLS with a certificate for localhost that it signed itself", async ({ baseURL, page }) => {
  const url = new URL(baseURL ?? "https://localhost:3200")
  expect(url.protocol).toBe("https:")

  const { certificate, authorizationError, protocol } = await handshakeWith(url)

  expect(protocol).toMatch(/^TLSv1\.[23]$/)
  expect(certificate.subject.CN).toBe("localhost")
  // Self-signed: it names itself as its issuer, and no authority Node trusts issued it.
  expect(certificate.issuer).toEqual(certificate.subject)
  expect(authorizationError).toBe("DEPTH_ZERO_SELF_SIGNED_CERT")
  expect(certificate.subjectaltname).toContain("DNS:localhost")
  expect(new Date(certificate.valid_to).getTime()).toBeGreaterThan(Date.now())

  const response = await page.goto("/")
  expect(response?.url()).toMatch(/^https:/)
  expect(response?.status()).toBe(200)
})
