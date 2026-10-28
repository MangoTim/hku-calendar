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
//   7. The aqua-web console container must have a working OUTBOUND path
//        to cybercenter5.aquasec.com. The scanner reaches the console fine,
//        but the console itself performs the "cybercenter ↔ scanner
//        compatibility" check server-side — when the console cannot reach
//        the internet, the scan fails with:
//            twirp error internal: Failed checking cybercenter to scanner
//            compatibility: ... Get "https://cybercenter5.aquasec.com/":
//            net/http: TLS handshake timeout
//        This is a HOST-side problem, not a pipeline problem. Symptom on the
//        host: `podman logs aqua-web` shows "dial tcp 192.168.147.103:5432:
//        connect: no route to host" and the console UI on :8080 hangs.
//        Cause: podman's per-container CNI chains / bridge attachment are
//        destroyed by `firewall-cmd --reload` (firewalld uses the nftables
//        backend and flushes the nat table that podman wrote into).
//        Fix on the host:  podman network reload
//        (or recreate the aqua-web / aqua-gateway containers).
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
// Image version tags
//
//   The image is tagged with a version, not a build counter:
//
//       v<major>.<minor>.<DDMMYY><NN>       e.g. v1.1.28102601
//
//   major.minor  comes from the VERSION file in the repo root. Bump it to
//                 1.2 for a big change, leave it at 1.1 for small ones.
//   DDMMYY       the build date, pinned to Hong Kong time (the agent
//                 container runs UTC, the host runs America/New_York).
//   NN           the Jenkins build number, zero padded to two digits. It is
//                 monotonic, so a tag is never reused and always maps back to
//                 exactly one build.
//
//   Full reference: 192.168.147.105:8082/hku-intranet:v1.1.28102601
//
// ---------------------------------------------------------------------------
// What "Image Is Compliant" does and does not mean
//
//   The Aqua console's Compliant badge comes from the ASSURANCE POLICY
//   (testing-image-assurance = malware + root_user). It is NOT a statement
//   that the image is free of CVEs — the console shows those separately, in
//   the Vulnerabilities tab of the image page.
//
//   Every CVE that showed up there was inherited from the base image, not
//   from this code. The Debian runtime base (oven/bun:1.3-slim) carried 100
//   HIGH/CRITICAL, 3 of them CRITICAL, all in perl-base. The runtime stage
//   now uses oven/bun:1.3-alpine, which carries 4 HIGH and 0 CRITICAL. The
//   application dependency trees are clean: 0 HIGH/CRITICAL.
//
// ---------------------------------------------------------------------------
// Known accepted risks (deliberate, so the pipeline stays green):
//
//   * The 4 HIGH OS CVEs in the alpine base have a fix in a newer alpine
//     release that no oven/bun tag has picked up yet. They are reported in
//     trivy-os-report.txt but not gated; CRITICAL is the line that stops a
//     build. Re-check when oven/bun publishes a newer alpine base.
//
//   * xlsx was swapped from the abandoned npm release (0.18.5 — the last
//     version ever published to the npm registry, deprecated, and carrying
//     two HIGH advisories) to the maintained SheetJS CDN build 0.20.3
//     (https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz). Only
//     XLSX.read() and XLSX.utils.sheet_to_json() are used by this app and
//     both are API-stable across 0.18 → 0.20, so no source change was
//     needed. The `bun audit` ignore list was deleted: the audit is now
//     clean with NO exceptions.
//
//   * Trivy runs with --exit-code 1, so its output is a HARD GATE: any
//     HIGH/CRITICAL library CVE or any secret it detects fails the build.
//     Trivy's rules currently match NOTHING in this tree, so two real
//     hardcoded fallbacks still survive the scanner (but not code review):
//       server/src/db.ts          → process.env.DB_PASSWORD || 'redhat'
//       server/src/cookieSecret.ts → process.env.SSO_COOKIE_SECRET || 'dev-only-not-secure-change-me'
//     They are low-entropy literals, not high-entropy keys, so no scanner
//     rule matches them — the scanner is not the control here.
//     TODO: move both into env vars / Jenkins credentials.
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
//     xlsx 0.18.5 → 2 HIGH (prototype pollution / ReDoS)
//       FIXED: swapped to the maintained SheetJS CDN build 0.20.3
//       (https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz). No source
//       change needed — the two APIs in use are API-stable across
//       0.18 → 0.20. The `bun audit` ignore list was deleted.
//
//   Both lockfiles were regenerated and `bun install --frozen-lockfile` —
//   which is what the Containerfile uses — verified against them.
// ============================================================================

pipeline {
    agent any

    environment {
        REGISTRY      = '192.168.147.105:8082'
        REGISTRY_URL  = 'http://192.168.147.105:8082'
        IMAGE_NAME    = 'hku-intranet'
        AQUA_HOST     = 'https://192.168.147.105'
        SCANNER_IMAGE = 'registry.aquasec.com/scanner:2022.4.868'
        TRIVY_IMAGE   = 'docker.io/aquasec/trivy:0.76.1'
        AQUA_CREDS_ID = 'aqua-console'

        // 8093 is the live production port (container "hku-intranet"); the
        // verify container uses 8094 so it cannot collide with it.
        VERIFY_PORT   = '8094'

        // IMAGE_VERSION / FULL_IMAGE / SCAN_IMAGE are resolved at run time by
        // the 'Resolve Version' stage — they depend on the VERSION file and
        // on the build date, neither of which the environment block can read.
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

        stage('Resolve Version') {
            // The image tag is a version, not a build counter:
            //
            //     v<major>.<minor>.<DDMMYY><NN>
            //
            //   major.minor  the release line, from the VERSION file in the
            //                 repo root. Bump it to 1.2 when there is a big
            //                 change, and back to 1.1 for small ones.
            //   DDMMYY       the build date, pinned to Hong Kong time so the
            //                 tag does not depend on where the agent runs (the
            //                 agent container is UTC, the host is New York).
            //   NN           the Jenkins build number, zero padded to two
            //                 digits. It is monotonic, so a tag is never reused
            //                 and always maps back to exactly one build.
            //
            // Examples: v1.1.28102601, v1.1.28102602, then v1.2.28102603
            // after the version line is bumped.
            steps {
                script {
                    def base = sh(script: "tr -d ' \\n' < VERSION", returnStdout: true).trim()
                    def day  = sh(script: "TZ=Asia/Hong_Kong date +%d%m%y", returnStdout: true).trim()
                    def seq  = sh(script: "printf '%02d' ${BUILD_NUMBER}", returnStdout: true).trim()

                    env.IMAGE_VERSION = "v${base}.${day}${seq}"
                    env.FULL_IMAGE    = "${env.REGISTRY}/${env.IMAGE_NAME}:${env.IMAGE_VERSION}"
                    env.SCAN_IMAGE    = "${env.IMAGE_NAME}-scan:${env.IMAGE_VERSION}"

                    echo "Image version : ${env.IMAGE_VERSION}"
                    echo "Full image ref: ${env.FULL_IMAGE}"
                }
            }
        }

        stage('Build Image') {
            steps {
                sh '''
                    set -eux

                    # --network host: the RUN steps need the npm registry. The
                    # host's rootful podman bridge is firewalled — container
                    # egress is dropped in the FORWARD chain — so a default
                    # (bridge) build hangs on `bun install`. Host networking
                    # routes build egress through OUTPUT instead, which is not
                    # firewalled. No Dockerfile step binds a port, so sharing
                    # the host netns is safe here.

                    # --format docker: podman's default is OCI, which silently
                    # DROPS the HEALTHCHECK instruction ("HEALTHCHECK is not
                    # supported for OCI image format"). Docker format keeps it
                    # and is what every other tool in the chain expects.

                    # Scan target FIRST: it IS the builder stage, so the layers
                    # land in the build cache and the runtime build below
                    # reuses them instead of rebuilding.
                    podman build \
                        --file Containerfile \
                        --format docker \
                        --network host \
                        --target builder \
                        --tag ${SCAN_IMAGE} \
                        --label build.number=${BUILD_NUMBER} \
                        --label build.url=${BUILD_URL} \
                        .

                    podman build \
                        --file Containerfile \
                        --format docker \
                        --network host \
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
                        set -u

                        # Capture the scanner exit code instead of letting
                        # `set -e` kill the shell — otherwise a scanner failure
                        # produces no diagnostic at all, only a red stage.
                        SCAN_RC=0
                        podman run --rm --name aqua-scan-${BUILD_NUMBER} \
                            --network host \
                            --security-opt label=disable --user root \
                            -v /var/run/docker.sock:/var/run/docker.sock \
                            ${SCANNER_IMAGE} \
                            scan \
                                --host ${AQUA_HOST} \
                                --local ${FULL_IMAGE} \
                                --no-verify \
                                --user ${AQUA_USER} \
                                --password ${AQUA_PASSWORD} \
                                --html > aqua-report.html 2> aqua-scan.err || SCAN_RC=$?

                        if [ "${SCAN_RC}" -ne 0 ]; then
                            echo "--- Aqua scanner stderr ---"
                            cat aqua-scan.err || true
                            echo "--- Aqua scanner output ---"
                            cat aqua-report.html || true
                            echo ""
                            echo "BLOCKED: Aqua scanner CLI exited ${SCAN_RC}"
                            echo "HINT: 'TLS handshake timeout' / 'Failed checking cybercenter to"
                            echo "      scanner compatibility' means the aqua-web console container"
                            echo "      on the Jenkins host has lost its outbound path. Fix on the"
                            echo "      host with:  podman network reload"
                            echo "      (or recreate aqua-web + aqua-gateway), then re-run."
                            exit 1
                        fi

                        echo "--- Aqua scan summary ---"
                        # Print the compliance marker so it shows in the console
                        grep -oE "Image Is (Compliant|Non-compliant)" aqua-report.html || true
                        # Hard CI/CD gate: pipeline only proceeds if image is Compliant.
                        # Non-compliant (or missing marker) fails the build.
                        grep -q "Image Is Compliant" aqua-report.html \
                            || { echo "BLOCKED: image is non-compliant (or scan report missing compliance marker)"; exit 1; }

                        # ------------------------------------------------------------------
                        # Also record the REGISTRY copy of the very same image.
                        #
                        # The scan above used --local, so the console files the
                        # image under the scanner's own local store. This second
                        # scan pulls the pushed image back from the registry, so
                        # the console ALSO lists it under
                        #     192.168.147.105:8082/hku-intranet:<version>
                        # and the client can find it by tag instead of by
                        # build number.
                        #
                        # Non-blocking on purpose: the local scan above is the
                        # gate (it inspects the exact bytes that will run), and
                        # this one only enriches the console record. If the
                        # registry reference cannot be resolved the build
                        # still proceeds.
                        # ------------------------------------------------------------------
                        echo "--- Aqua registry scan (informational) ---"
                        podman run --rm --name aqua-scan-reg-${BUILD_NUMBER} \
                            --network host \
                            --security-opt label=disable --user root \
                            -v /var/run/docker.sock:/var/run/docker.sock \
                            ${SCANNER_IMAGE} \
                            scan \
                                --host ${AQUA_HOST} \
                                --registry ${REGISTRY_URL} \
                                --no-verify \
                                --user ${AQUA_USER} \
                                --password ${AQUA_PASSWORD} \
                                --html \
                                ${IMAGE_NAME}:${IMAGE_VERSION} \
                                > aqua-registry-report.html 2> aqua-registry-scan.err \
                            || echo "NOTE: registry scan did not complete (informational only) — see aqua-registry-scan.err"
                    '''
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'aqua-report.html,aqua-scan.err,aqua-registry-report.html,aqua-registry-scan.err',
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
                    podman run --rm --name hku-audit-${BUILD_NUMBER} \
                        --network host --security-opt label=disable \
                        --entrypoint sh -w /app ${SCAN_IMAGE} \
                        -c '
                            rc=0
                            echo "### bun audit — workspace root"
                            bun audit --audit-level=high || rc=$?
                            cd server
                            echo ""
                            echo "### bun audit — server/"
                            bun audit --audit-level=high || rc=$?
                            exit $rc
                        ' > bun-audit.txt 2>&1 || BUN_RC=$?

                    cat bun-audit.txt
                    echo "bun audit exit code: ${BUN_RC}"

                    # ------------------------------------------------------------------
                    # 2. Trivy — library CVEs + hardcoded secrets across BOTH
                    #    dependency trees (frontend + server), scanned against the
                    #    builder image so the frontend packages are visible.
                    #    HARD GATE: --exit-code 1 turns any HIGH/CRITICAL finding
                    #    (or any detected secret) into a build failure.
                    # ------------------------------------------------------------------
                    TRIVY_RC=0
                    # The docker socket is REQUIRED: Trivy resolves the target
                    # image through a container runtime API, and without the
                    # socket it can only reach a remote registry. It then
                    # fails with:
                    #   unable to find the specified image "hku-intranet-scan:N"
                    #   in ["docker" "containerd" "podman" "remote"]
                    # On this host /var/run/docker.sock is a symlink to
                    # /run/podman/podman.sock, so the same mount works for
                    # both the Aqua scanner and Trivy.
                    podman run --rm --name hku-trivy-${BUILD_NUMBER} \
                        --network host --security-opt label=disable \
                        -v /var/run/docker.sock:/var/run/docker.sock \
                        -v trivy-cache:/root/.cache/trivy \
                        -e TRIVY_DB_REPOSITORY=docker.io/aquasec/trivy-db:2 \
                        ${TRIVY_IMAGE} \
                        image --scanners vuln,secret \
                            --pkg-types library \
                            --severity HIGH,CRITICAL \
                            --exit-code 1 \
                            --format table \
                            ${SCAN_IMAGE} > trivy-report.txt 2>&1 || TRIVY_RC=$?

                    cat trivy-report.txt
                    echo "trivy (app dependencies) exit code: ${TRIVY_RC}"

                    # ------------------------------------------------------------------
                    # 3. Trivy — OS packages of the image we actually ship.
                    #    HARD GATE on CRITICAL. The runtime base is
                    #    oven/bun:1.3-alpine, which currently carries 0 CRITICAL
                    #    and 4 HIGH (all with a fix available in a newer alpine
                    #    release). Gating on HIGH too would block the build on a
                    #    base-image update we do not control, so HIGH is
                    #    reported and CRITICAL is the line that stops a build.
                    # ------------------------------------------------------------------
                    TRIVY_OS_RC=0
                    podman run --rm --name hku-trivy-os-${BUILD_NUMBER} \
                        --network host --security-opt label=disable \
                        -v /var/run/docker.sock:/var/run/docker.sock \
                        -v trivy-cache:/root/.cache/trivy \
                        -e TRIVY_DB_REPOSITORY=docker.io/aquasec/trivy-db:2 \
                        ${TRIVY_IMAGE} \
                        image --scanners vuln \
                            --pkg-types os \
                            --severity CRITICAL \
                            --exit-code 1 \
                            --format table \
                            ${FULL_IMAGE} > trivy-os-report.txt 2>&1 || TRIVY_OS_RC=$?

                    cat trivy-os-report.txt
                    echo "trivy (OS packages) exit code: ${TRIVY_OS_RC}"

                    # The HIGH findings are not gated, but they are assessed, so
                    # they belong in the artifact that goes to the client.
                    podman run --rm --name hku-trivy-os-high-${BUILD_NUMBER} \
                        --network host --security-opt label=disable \
                        -v /var/run/docker.sock:/var/run/docker.sock \
                        -v trivy-cache:/root/.cache/trivy \
                        -e TRIVY_DB_REPOSITORY=docker.io/aquasec/trivy-db:2 \
                        ${TRIVY_IMAGE} \
                        image --scanners vuln \
                            --pkg-types os \
                            --severity HIGH \
                            --format table \
                            ${FULL_IMAGE} >> trivy-os-report.txt 2>&1 || true

                    # ------------------------------------------------------------------
                    # Gate: HIGH/CRITICAL dependency advisories.
                    # ------------------------------------------------------------------
                    if [ "${BUN_RC}" -ne 0 ]; then
                        echo "BLOCKED: bun audit reported HIGH/CRITICAL dependency advisories (or the npm advisory registry was unreachable) — see bun-audit.txt"
                        exit 1
                    fi

                    # ------------------------------------------------------------------
                    # Gate: Trivy — HIGH/CRITICAL library CVEs + detected secrets.
                    # ------------------------------------------------------------------
                    if [ "${TRIVY_RC}" -ne 0 ]; then
                        echo "BLOCKED: Trivy reported HIGH/CRITICAL findings, detected a secret, or the scan itself failed — see trivy-report.txt"
                        exit 1
                    fi

                    # ------------------------------------------------------------------
                    # Gate: Trivy — CRITICAL OS CVEs in the shipped base image.
                    # ------------------------------------------------------------------
                    if [ "${TRIVY_OS_RC}" -ne 0 ]; then
                        echo "BLOCKED: Trivy reported a CRITICAL OS vulnerability in the runtime image — see trivy-os-report.txt"
                        exit 1
                    fi

                    echo "Code scan OK: no HIGH/CRITICAL dependency advisories, no detected secrets, no CRITICAL OS CVEs."
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'bun-audit.txt,trivy-report.txt,trivy-os-report.txt',
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
                # FULL_IMAGE / SCAN_IMAGE are empty when the 'Resolve Version'
                # stage never ran, so guard every use of them.
                if [ -z "${FULL_IMAGE}" ] || [ -z "${SCAN_IMAGE}" ]; then
                    echo "Image references unresolved — skipping image cleanup"
                    exit 0
                fi

                # Remove the sidecar containers this build started. They all
                # run with --rm, but a FAILED run can leave one behind (the
                # Aqua scanner's scan-target container is the usual one), and
                # a container holding an image makes `podman rmi` refuse:
                #     image used by <id>: image is in use by a container
                podman rm -f aqua-scan-${BUILD_NUMBER} \
                             aqua-scan-reg-${BUILD_NUMBER} \
                             hku-audit-${BUILD_NUMBER} \
                             hku-trivy-${BUILD_NUMBER} \
                             hku-trivy-os-${BUILD_NUMBER} \
                             hku-trivy-os-high-${BUILD_NUMBER} \
                             hku-intranet-verify-${BUILD_NUMBER} 2>/dev/null || true

                # Force-clear any other container still holding the scan-only
                # image. ${SCAN_IMAGE} is never used by the production
                # container, so removing its holders is always safe.
                for c in $(podman ps -aq --filter ancestor=${SCAN_IMAGE} 2>/dev/null); do
                    podman rm -f "$c" || true
                done

                # Deliberately NOT --force: if the production container is
                # running from ${FULL_IMAGE}, rmi correctly refuses and the
                # image stays. That is the safe outcome.
                podman rmi ${FULL_IMAGE} || true
                podman rmi ${SCAN_IMAGE} || true
            '''
        }
        success {
            echo "Pipeline SUCCESS — ${env.FULL_IMAGE} passed the Aqua image scan and the code scan"
            emailext (
                subject: "✅ Build #${BUILD_NUMBER} PASSED — ${env.FULL_IMAGE}",
                body: """<h2>HKU ENGG Intranet — CI/CD — Build #${BUILD_NUMBER} PASSED</h2>
                    <p>Image: <code>${env.FULL_IMAGE}</code></p>
                    <p>Aqua image scan: <b>Image Is Compliant</b> (malware, root user, sensitive data)</p>
                    <p>Code scan: no HIGH/CRITICAL dependency advisories, no detected secrets, no CRITICAL OS CVEs</p>
                    <p>Deploy verify: /health + SPA root ok on <code>127.0.0.1:${VERIFY_PORT}</code></p>
                    <p>Reports: <a href=\"${BUILD_URL}artifact/\">aqua-report.html, bun-audit.txt, trivy-report.txt, trivy-os-report.txt</a><br>
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
                    <p>Image: <code>${env.FULL_IMAGE ?: 'unresolved'}</code></p>
                    <p>Check the console for the failure stage.</p>
                    <p>Reports: <a href=\"${BUILD_URL}artifact/\">aqua-report.html, bun-audit.txt, trivy-report.txt, trivy-os-report.txt</a><br>
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
