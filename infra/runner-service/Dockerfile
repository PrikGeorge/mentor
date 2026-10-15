# syntax=docker/dockerfile:1
# JAR_SOURCE=build (default): compile the runner inside the image; JAR_SOURCE=prebuilt: copy runner/target/runner-*.jar
# built on the host. See infra/backend/Dockerfile for the rationale. The build reads contracts/runner.openapi.yaml
# (openapi-generator) and the harness resources, which .gitattributes pins to LF so image digests stay stable.
ARG JAR_SOURCE=build

FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /workspace
# The root POM lists both modules, so Maven needs backend/pom.xml to assemble the reactor even for -pl runner.
COPY pom.xml ./
COPY contracts/runner.openapi.yaml contracts/
COPY backend/pom.xml backend/
COPY runner/pom.xml runner/
COPY runner/src runner/src
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -pl runner -DskipTests package \
    && mkdir -p /out && cp runner/target/runner-*.jar /out/runner.jar

FROM scratch AS prebuilt
COPY runner/target/runner-*.jar /out/runner.jar

FROM ${JAR_SOURCE} AS jar

FROM docker:29.9.0-cli@sha256:1a4c7cb63513f349bdad01fcc6e0f3f2f67d37b9da86f14dc0d4a0942eecda00 AS docker_cli
FROM eclipse-temurin:21-jre-jammy@sha256:f04fb34e053148344e83317976114ec3f37e4b830ec8bdab5a2fe3cecd7d010b
# USN-8847-1; retain the JRE/OS baseline until its official image includes this fix.
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade libssl3=3.0.2-0ubuntu1.30 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
RUN groupadd --gid 10001 mentor && useradd --uid 10001 --gid mentor --no-create-home --shell /usr/sbin/nologin mentor
WORKDIR /opt/mentor
COPY --from=jar --chown=10001:10001 /out/runner.jar /opt/mentor/runner.jar
USER 10001:10001
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-jar", "/opt/mentor/runner.jar"]
