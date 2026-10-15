package ru.mentor.platform.migration;

import org.springframework.jdbc.datasource.AbstractDataSource;

import java.lang.reflect.*;
import java.sql.*;
import java.util.concurrent.locks.ReentrantLock;

import javax.sql.DataSource;

/** Database-wide cutover gate. Session locks are owned by the SQL connection they protect. */
public final class DatabaseGate extends AbstractDataSource implements AutoCloseable {
    public static final int KEY_NAMESPACE = 1296387668, KEY_OPERATION = 1229803591;
    private static final String KEY = KEY_NAMESPACE + "," + KEY_OPERATION;
    private final DataSource pool;
    private final boolean offline;
    private final ReentrantLock serial = new ReentrantLock(true);
    private Connection presence;
    private volatile boolean closed;

    public DatabaseGate(DataSource pool, boolean offline) throws SQLException {
        this.pool = pool;
        this.offline = offline;
        try {
            presence = pool.getConnection();
            acquire(presence, offline);
            if (!offline) requireComplete(presence);
        } catch (SQLException failed) {
            discard(presence);
            if (pool instanceof AutoCloseable closeable)
                try {
                    closeable.close();
                } catch (Exception ignored) {
                }
            throw failed;
        }
    }

    public boolean offline() {
        return offline;
    }

    private static boolean value(Connection c, String sql) throws SQLException {
        try (var s = c.createStatement();
                var r = s.executeQuery(sql)) {
            r.next();
            return r.getBoolean(1);
        }
    }

    private static void acquire(Connection c, boolean exclusive) throws SQLException {
        if (!value(
                c, "SELECT pg_try_advisory_lock" + (exclusive ? "" : "_shared") + "(" + KEY + ")"))
            throw new SQLException(
                    "Database maintenance is in progress or a runtime is still active.", "55000");
    }

    private static void release(Connection c, boolean exclusive) throws SQLException {
        if (!value(c, "SELECT pg_advisory_unlock" + (exclusive ? "" : "_shared") + "(" + KEY + ")"))
            throw new SQLException("Database maintenance ownership lost.", "55000");
    }

    private static void requireComplete(Connection c) throws SQLException {
        if (value(c, "SELECT to_regclass('public.import_run') IS NOT NULL")
                && value(c, "SELECT EXISTS(SELECT 1 FROM import_run WHERE state<>'completed')"))
            throw new SQLException(
                    "An incomplete legacy import prevents opening this database.", "55000");
    }

    /** Reacquisition is always lock first, durable barrier second. No optimistic boolean admission. */
    private synchronized void ensurePresence() throws SQLException {
        if (closed) throw new SQLException("Database gate closed.");
        if (presence != null && presence.isValid(2)) return;
        discard(presence);
        presence = null;
        if (offline)
            throw new SQLException(
                    "Offline database connection was lost; resume the durable run.", "08006");
        Connection next = pool.getConnection();
        try {
            acquire(next, false);
            requireComplete(next);
            presence = next;
        } catch (SQLException failed) {
            discard(next);
            throw failed;
        }
    }

    @Override
    public Connection getConnection() throws SQLException {
        if (offline) {
            serial.lock();
            try {
                ensurePresence();
                return logical(presence, true);
            } catch (SQLException e) {
                serial.unlock();
                throw e;
            }
        }
        ensurePresence();
        Connection connection = pool.getConnection();
        try {
            acquire(connection, false);
            requireComplete(connection);
            return logical(connection, false);
        } catch (SQLException failed) {
            discard(connection);
            throw failed;
        }
    }

    @Override
    public Connection getConnection(String user, String password) throws SQLException {
        throw new SQLException("Configured database credentials only.");
    }

    /** Required by import facades before starting a fenced transaction; the connection is never replaced after loss. */
    public void requireOffline() {
        if (!offline || closed) throw new IllegalStateException("Offline import scope required.");
    }

    private Connection logical(Connection physical, boolean dedicated) {
        InvocationHandler handler =
                new InvocationHandler() {
                    boolean returned;

                    public Object invoke(Object proxy, Method method, Object[] args)
                            throws Throwable {
                        String name = method.getName();
                        if (name.equals("close")) {
                            if (returned) return null;
                            returned = true;
                            if (dedicated) {
                                serial.unlock();
                                return null;
                            }
                            try {
                                if (!physical.getAutoCommit()) {
                                    physical.rollback();
                                    physical.setAutoCommit(true);
                                }
                                release(physical, false);
                                physical.close();
                            } catch (SQLException failure) {
                                discard(physical);
                            }
                            return null;
                        }
                        if (name.equals("isClosed")) return returned || physical.isClosed();
                        if (name.equals("unwrap")) {
                            if (((Class<?>) args[0]).isInstance(proxy)) return proxy;
                            throw new SQLException("Raw gate connection is not exposed.");
                        }
                        if (name.equals("isWrapperFor"))
                            return ((Class<?>) args[0]).isInstance(proxy);
                        if (returned) throw new SQLException("Connection returned.");
                        try {
                            return method.invoke(physical, args);
                        } catch (InvocationTargetException e) {
                            throw e.getCause();
                        }
                    }
                };
        return (Connection)
                Proxy.newProxyInstance(
                        Connection.class.getClassLoader(),
                        new Class<?>[] {Connection.class},
                        handler);
    }

    private static void discard(Connection connection) {
        if (connection == null) return;
        try {
            connection.abort(Runnable::run);
        } catch (Exception ignored) {
        }
        try {
            connection.close();
        } catch (Exception ignored) {
        }
    }

    @Override
    public synchronized void close() {
        closed = true;
        if (presence != null) {
            try {
                if (!presence.getAutoCommit()) presence.rollback();
                release(presence, offline);
                presence.close();
            } catch (Exception lost) {
                discard(presence);
            }
            presence = null;
        }
        if (pool instanceof AutoCloseable closeable)
            try {
                closeable.close();
            } catch (Exception ignored) {
            }
    }
}
