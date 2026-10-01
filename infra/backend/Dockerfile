FROM eclipse-temurin:21-jre-jammy@sha256:e9aaf73145bbd1f9f6ec7f6867dd75a44f34b1a6c32a813504bf4129be2d09d7
RUN groupadd --gid 10001 mentor && useradd --uid 10001 --gid mentor --no-create-home --shell /usr/sbin/nologin mentor \
    && mkdir -p /var/lib/mentor/objects /var/lib/mentor/spool && chown -R mentor:mentor /var/lib/mentor
WORKDIR /opt/mentor
COPY --chown=10001:10001 backend/target/backend-0.1.0-SNAPSHOT.jar /opt/mentor/app.jar
USER 10001:10001
EXPOSE 8081
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/opt/mentor/app.jar"]
