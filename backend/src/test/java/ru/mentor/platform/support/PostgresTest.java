package ru.mentor.platform.support;

import org.testcontainers.postgresql.PostgreSQLContainer;

public abstract class PostgresTest {
    protected static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.6-alpine")
        .withDatabaseName("mentor_test").withUsername("synthetic").withPassword("synthetic-only");
}
