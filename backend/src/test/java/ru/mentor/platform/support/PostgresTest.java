package ru.mentor.platform.support;

import org.testcontainers.postgresql.PostgreSQLContainer;

public abstract class PostgresTest {
    protected static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(org.testcontainers.utility.DockerImageName.parse("postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24").asCompatibleSubstituteFor("postgres"))
        .withDatabaseName("mentor_test").withUsername("synthetic").withPassword("synthetic-only");
}
