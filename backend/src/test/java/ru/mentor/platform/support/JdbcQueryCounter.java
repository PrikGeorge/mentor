package ru.mentor.platform.support;

import org.springframework.jdbc.datasource.AbstractDataSource;

import javax.sql.DataSource;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HashSet;
import java.util.Set;

/** Counts executed queries and returned rows/columns without replacing PostgreSQL behavior. */
public final class JdbcQueryCounter extends AbstractDataSource {
    private final DataSource delegate;
    private int queries;
    private int rows;
    private final Set<String> columns = new HashSet<>();

    public JdbcQueryCounter(DataSource delegate) { this.delegate = delegate; }
    public int queries() { return queries; }
    public int rows() { return rows; }
    public Set<String> columns() { return Set.copyOf(columns); }
    public void reset() { queries = 0; rows = 0; columns.clear(); }

    @Override public Connection getConnection() throws SQLException { return connection(delegate.getConnection()); }
    @Override public Connection getConnection(String username, String password) throws SQLException {
        return connection(delegate.getConnection(username, password));
    }
    private Connection connection(Connection actual) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[]{Connection.class}, (proxy, method, args) -> {
            Object result = invoke(actual, method, args);
            if (result instanceof PreparedStatement statement) return statement(statement);
            return result;
        });
    }
    private PreparedStatement statement(PreparedStatement actual) {
        return (PreparedStatement) Proxy.newProxyInstance(PreparedStatement.class.getClassLoader(), new Class<?>[]{PreparedStatement.class}, (proxy, method, args) -> {
            if (method.getName().equals("executeQuery")) queries++;
            Object result = invoke(actual, method, args);
            if (result instanceof ResultSet set) return result(set);
            return result;
        });
    }
    private ResultSet result(ResultSet actual) throws SQLException {
        var metadata = actual.getMetaData();
        for (int i = 1; i <= metadata.getColumnCount(); i++) columns.add(metadata.getColumnLabel(i));
        return (ResultSet) Proxy.newProxyInstance(ResultSet.class.getClassLoader(), new Class<?>[]{ResultSet.class}, (proxy, method, args) -> {
            Object result = invoke(actual, method, args);
            if (method.getName().equals("next") && Boolean.TRUE.equals(result)) rows++;
            return result;
        });
    }
    private static Object invoke(Object target, java.lang.reflect.Method method, Object[] arguments) throws Throwable {
        try { return method.invoke(target, arguments); }
        catch (InvocationTargetException failed) { throw failed.getCause(); }
    }
}
