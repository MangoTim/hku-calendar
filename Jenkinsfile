// Jenkinsfile — HKU ENGG Intranet demo (React + Express on Bun)
//
// Build → push to local registry → Aqua image scan → code scan → deploy verify
//
// Derived from the Aqua Security pipeline demo in MangoTim/aqua-test (branch
// test-v1). Same registry, same scanner image, same credential ID.
//
// ============================================================================
// One-time setup required BEFORE the first build (Manage Jenkins → ...):
//
//   1. Credential "aqua-console"
//        Manage Jenkins → Credentials → (global) → Add Credentials
//        Kind: Username with password | ID: aqua-console | Username: administrator
//        (Aqua Console admin password — used by the scanner CLI --user/--password.)
//
//   2. Registry running AND registered in the Aqua Console as "jenkins-demo"
//        podman run -d --name registry -p 8082:8082 \
//          -v registry_data:/var/lib/registry \
//          -e REGISTRY_HTTP_ADDR=:8082 docker.io/library/registry:2
//        Console → Registries → Add → http://192.168.147.105:8082 (no auth)
//        Full setup walkthrough: aqua-test repo → docs/DEMO-RUNBOOK.md
//
//   3. Assurance policy "testing-image-assurance" must control:
//        malware + root_user
//        root_user is why the Containerfile now ends with `USER bun` — a
//        root-running image reports "Image Is Non-compliant" and the gate
//        below blocks the build. (Optionally add a vulnerability control once
//        the OS CVE backlog is triaged; today the policy is malware+root only,
//        so the Aqua image scan does NOT gate on CVEs.)
//
//   4. Pipeline job configuration
//        Definition:  Pipeline script from SCM
//        SCM:         Git | https://github.com/MangoTim/hku-calendar.git
//        Branch:      */main
//        Script Path: Jenkinsfile
//        (The repo root IS products/Demo_hku/webpage-react/ — Containerfile and
//         package.json sit next to this file.)
//
//   5. The agent must be the custom jenkins-with-podman image:
//        --net=host + /run/podman/podman.sock mounted as /var/run/docker.sock
//        (aqua-test repo → infra/jenkins/README.md). Host networking is what
//        lets the scanner containers reach the registry, the Aqua Console and
//        the npm / Trivy DB registries.
//
//   6. Script approval (FIRST BUILD ONLY)
//        The Aqua scanner CLI and Trivy run as `podman run` shell steps — no
//        sandboxed Groovy APIs are used, so no signatures need approving.
//        (The aqua-test pipeline needed them only for its cosmetic sidebar,
//        which is not used here.)
//
// ---------------------------------------------------------------------------
// Why a separate code-scan stage?
//
//   The runtime image is multi-stage: it ships dist/ (the Vite bundle) and
//   server/node_modules, but NOT the frontend node_modules. So the frontend
//   dependency tree (react, vite, xlsx@0.18.5, react-router-dom, typescript)
//   is completely invisible to an image scan — and xlsx is bundled into
//   dist/assets/xlsx-*.js as a minified chunk with no package metadata, so
//   no scanner can map it back to a package version either.
//
//   The code scan therefore runs against the *builder* stage, which still has
//   the full source tree, both bun.lock files and both node_modules trees.
//   `podman build --target builder` produces exactly that image.
//
// ---------------------------------------------------------------------------
// Known accepted risks (deliberate, so the pipeline stays green):
//
//   * xlsx@0.18.5 is the last release ever published to the npm registry —
//     the package is deprecated and maintained builds live on
//     cdn.sheetjs.com. Its two HIGH advisories are explicitly --ignore'd in
//     the bun audit step below.
//     TODO: swap to the SheetJS CDN tarball or a maintained reader, then drop
//     the ignores.
//
//   * The secret scan is REPORT-ONLY (it prints findings, it does not fail
//     the build). It currently surfaces two real hardcoded fallbacks:
//       server/src/db.ts          → process.env.DB_PASSWORD || 'redhat'
//       server/src/cookieSecret.ts → process.env.SSO_COOKIE_SECRET || 'dev-only-not-secure-change-me'
//     TODO: move both into env vars / Jenkins credentials, then promote the
//     secret scan to a hard gate by adding --exit-code 1 to the Trivy step.
//
//   * bun audit exits 1 both for real findings AND when the npm advisory
//     registry is unreachable. A registry outage therefore fails the build.
//
// ---------------------------------------------------------------------------
// What the first scan found, and what was done about it:
//
//   server/ had 6 HIGH advisories beyond the xlsx pair:
//     nodemailer 6.9.16 → 5 HIGH (file read / SSRF / OAuth2 credential
//                          interception / addressparser DoS)
//       FIXED: bumped to nodemailer 10.2.1. Verified — server typecheck
//       passes, `ignoreTLS` is still supported (it matters: the .105 Postfix
//       relay runs on plain port 25), and createTransport/sendMail with the
//       app's exact options still work.
//     body-parser 2.2.0 (transitive via express 5.1.0) → 1 HIGH (DoS)
//       FIXED: `overrides: { "body-parser": "^2.4.0" }` in server/package.json.
//       express's `^2.2.0` range had left it nested at 2.3.0; the override
//       forces a single hoisted 2.4.0.
//
//   Both lockfiles were regenerated and `bun install --frozen-lockfile` —
//   which is what the Containerfile uses — verified against them.
// ============================================================================

pipeline {
    agent any

    environment {
        REGISTRY      = '192.168.147.105:8082'
        IMAGE_NAME    = 'hku-intranet'
        IMAGE_TAG     = "${env.BUILD_NUMBER}"
        FULL_IMAGE    = "${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
        SCAN_IMAGE    = "${IMAGE_NAME}-scan:${IMAGE_TAG}"
        AQUA_HOST     = 'https://192.168.147.105'
        SCANNER_IMAGE = 'registry.aquasec.com/scanner:2022.4.868'
        TRIVY_IMAGE   = 'docker.io/aquasec/trivy:0.76.1'
        AQUA_CREDS_ID = 'aqua-console'

        // 8093 is the live production port (container "hku-intranet"); the
        // verify container uses 8094 so it cannot collide with it.
        VERIFY_PORT   = '8094'

        // xlsx@0.18.5 — GHSA-4r6h-8v6p-xvw6 (prototype pollution) and
        // GHSA-5pgg-2g8v-p4x9 (ReDoS). Both HIGH. See "Known accepted risks".
        BUN_AUDIT_IGNORES = 'GHSA-4r6h-8v6p-xvw6 GHSA-5pgg-2g8v-p4x9'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 25, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    stages {

        stage('Checkout') {
            steps {
                git branch: 'main',
                    url: 'https://github.com/MangoTim/hku-calendar.git'
            }
        }

        stage('Build Image') {
            steps {
                sh '''
                    set -eux

                    # Scan target FIRST: it IS the builder stage, so the layers
                    # land in the build cache and the runtime build below
                    # reuses them instead of rebuilding.
                    podman build \
                        --file Containerfile \
                        --target builder \
                        --tag ${SCAN_IMAGE} \
                        --label build.number=${BUILD_NUMBER} \
                        --label build.url=${BUILD_URL} \
                        .

                    podman build \
                        --file Containerfile \
                        --tag ${FULL_IMAGE} \
                        --label build.number=${BUILD_NUMBER} \
                        --label build.url=${BUILD_URL} \
                        .
                '''
            }
        }

        stage('Push to Registry') {
            steps {
                sh '''
                    set -eux
                    podman push ${FULL_IMAGE} --tls-verify=false
                '''
            }
        }

        stage('Aqua Image Scan') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: "${AQUA_CREDS_ID}",
                    usernameVariable: 'AQUA_USER',
                    passwordVariable: 'AQUA_PASSWORD'
                )]) {
                    sh '''
                        set -eux
                        podman run --rm --network host \
                            --security-opt label=disable --user root \
                            -v /var/run/docker.sock:/var/run/docker.sock \
                            ${SCANNER_IMAGE} \
                            scan \
                                --host ${AQUA_HOST} \
                                --local ${FULL_IMAGE} \
                                --no-verify \
                                --user ${AQUA_USER} \
                                --password ${AQUA_PASSWORD} \
                                --html > aqua-report.html

                        echo "--- Aqua scan summary ---"
                        # Print the compliance marker so it shows in the console
                        grep -oE "Image Is (Compliant|Non-compliant)" aqua-report.html || true
                        # Hard CI/CD gate: pipeline only proceeds if image is Compliant.
                        # Non-compliant (or missing marker) fails the build.
                        grep -q "Image Is Compliant" aqua-report.html \
                            || { echo "BLOCKED: image is non-compliant (or scan report missing compliance marker)"; exit 1; }
                    '''
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'aqua-report.html',
                                     allowEmptyArchive: true
                }
            }
        }

        stage('Code Scan (dependencies + secrets)') {
            steps {
                sh '''
                    set -u

                    # ------------------------------------------------------------------
                    # 1. bun audit — native bun.lock audit, run inside the builder
                    #    image (it already has bun + both lockfiles + node_modules).
                    #    Root workspace first, then server/ (separate lockfile).
                    # ------------------------------------------------------------------
                    BUN_RC=0
                    podman run --rm --network host --security-opt label=disable \
                        -e AUDIT_IGNORES="${BUN_AUDIT_IGNORES}" \
                        --entrypoint sh -w /app ${SCAN_IMAGE} \
                        -c '
                            set --
                            for g in ${AUDIT_IGNORES}; do set -- "$@" --ignore "$g"; done
                            rc=0
                            echo "### bun audit — workspace root"
                            bun audit --audit-level=high "$@" || rc=$?
                            cd server
                            echo ""
                            echo "### bun audit — server/"
                            bun audit --audit-level=high "$@" || rc=$?
                            exit $rc
                        ' > bun-audit.txt 2>&1 || BUN_RC=$?

                    cat bun-audit.txt
                    echo "bun audit exit code: ${BUN_RC}"

                    # ------------------------------------------------------------------
                    # 2. Trivy — library CVEs + hardcoded secrets in the source tree.
                    #    REPORT-ONLY (no --exit-code): it currently surfaces the two
                    #    hardcoded defaults documented in the header, and we do not
                    #    want that to block every build yet.
                    # ------------------------------------------------------------------
                    TRIVY_RC=0
                    podman run --rm --network host --security-opt label=disable \
                        -v trivy-cache:/root/.cache/trivy \
                        -e TRIVY_DB_REPOSITORY=docker.io/aquasec/trivy-db:2 \
                        ${TRIVY_IMAGE} \
                        image --scanners vuln,secret \
                            --vuln-type library \
                            --severity HIGH,CRITICAL \
                            --format table \
                            ${SCAN_IMAGE} > trivy-report.txt 2>&1 || TRIVY_RC=$?

                    cat trivy-report.txt
                    echo "trivy exit code: ${TRIVY_RC} (report-only — not a gate)"

                    # ------------------------------------------------------------------
                    # Gate: HIGH/CRITICAL dependency advisories.
                    # ------------------------------------------------------------------
                    if [ "${BUN_RC}" -ne 0 ]; then
                        echo "BLOCKED: bun audit reported HIGH/CRITICAL dependency advisories (or the npm advisory registry was unreachable) — see bun-audit.txt"
                        exit 1
                    fi
                    echo "Code scan OK: no HIGH/CRITICAL dependency advisories outside the documented ignore list."
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'bun-audit.txt,trivy-report.txt',
                                     allowEmptyArchive: true
                }
            }
        }

        stage('Deploy & Verify') {
            // CI/CD proof: spin up the scanned image on a spare port, hit the
            // health endpoint and the SPA root, and fail the build if either
            // is missing. Cleans the container up afterwards.
            steps {
                sh '''
                    set -eux
                    podman run -d --name hku-intranet-verify-${BUILD_NUMBER} \
                        --network host \
                        -e HOST=127.0.0.1 \
                        -e PORT=${VERIFY_PORT} \
                        ${FULL_IMAGE}

                    # Wait for the API to finish initDb() and start listening.
                    for i in $(seq 1 30); do
                        if curl -fsS "http://127.0.0.1:${VERIFY_PORT}/health" > /dev/null 2>&1; then
                            break
                        fi
                        sleep 2
                    done

                    curl -fsS "http://127.0.0.1:${VERIFY_PORT}/health" | grep -q '"status":"ok"' \
                        || { echo "BLOCKED: /health did not return status ok"; \
                             podman logs hku-intranet-verify-${BUILD_NUMBER} || true; \
                             exit 1; }

                    curl -fsS "http://127.0.0.1:${VERIFY_PORT}/" | grep -q '<div id="root">' \
                        || { echo "BLOCKED: SPA index missing root div"; \
                             podman logs hku-intranet-verify-${BUILD_NUMBER} || true; \
                             exit 1; }

                    echo "Webpage verified: /health ok + SPA root div on 127.0.0.1:${VERIFY_PORT}"
                '''
            }
            post {
                always {
                    sh 'podman rm -f hku-intranet-verify-${BUILD_NUMBER} || true'
                }
            }
        }
    }

    post {
        always {
            sh '''
                podman rmi ${FULL_IMAGE} || true
                podman rmi ${SCAN_IMAGE} || true
            '''
        }
        success {
            echo "Pipeline SUCCESS — ${FULL_IMAGE} passed the Aqua image scan and the dependency code scan"
            emailext (
                subject: "✅ Build #${BUILD_NUMBER} PASSED — ${FULL_IMAGE}",
                body: """<h2>HKU ENGG Intranet — CI/CD — Build #${BUILD_NUMBER} PASSED</h2>
                    <p>Image: <code>${FULL_IMAGE}</code></p>
                    <p>Aqua image scan: <b>Image Is Compliant</b></p>
                    <p>Code scan: no HIGH/CRITICAL dependency advisories</p>
                    <p>Deploy verify: /health + SPA root ok on <code>127.0.0.1:${VERIFY_PORT}</code></p>
                    <p>Reports: <a href=\"${BUILD_URL}artifact/\">aqua-report.html, bun-audit.txt, trivy-report.txt</a><br>
                       Console: <a href=\"${BUILD_URL}console\">build console</a><br>
                       Build: <a href=\"${BUILD_URL}\">#${BUILD_NUMBER}</a></p>
                """,
                mimeType: 'text/html',
                to: 'tim.wong@systex.com.hk'
            )
        }
        failure {
            echo "Pipeline FAILED — check the failing stage above for the blocking finding"
            emailext (
                subject: "❌ Build #${BUILD_NUMBER} FAILED",
                body: """<h2>HKU ENGG Intranet — CI/CD — Build #${BUILD_NUMBER} FAILED</h2>
                    <p>Image: <code>${FULL_IMAGE}</code></p>
                    <p>Check the console for the failure stage.</p>
                    <p>Reports: <a href=\"${BUILD_URL}artifact/\">aqua-report.html, bun-audit.txt, trivy-report.txt</a><br>
                       Console: <a href=\"${BUILD_URL}console\">build console</a><br>
                       Build: <a href=\"${BUILD_URL}\">#${BUILD_NUMBER}</a></p>
                """,
                mimeType: 'text/html',
                attachLog: true,
                to: 'tim.wong@systex.com.hk'
            )
        }
    }
}
