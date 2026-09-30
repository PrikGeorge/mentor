package mentor.runner;

import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Trusted reflection/JSON bridge, adapted from algocode-local/Harness.java.
 * Student classes and dependencies use a separate class loader/protection domain.
 * This Java 21 policy is a development restriction, not an OS sandbox.
 */
@SuppressWarnings("removal")
public final class TrustedHarness {
    private static final int MAX_VALUES = 10000;
    private static final int OUTPUT_LIMIT = 16384;

    public static void main(String[] ignored) {
        PrintStream protocol = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        ByteArrayOutputStream capture = new ByteArrayOutputStream();
        boolean[] overflow = {false};
        Map<String,Object> response = new LinkedHashMap<>();
        try {
            if (System.getSecurityManager() == null) throw new SecurityException("Java policy is not active.");
            System.setSecurityManager(new SecurityManager() {
                @Override public void checkAccess(Thread thread) { checkPermission(new RuntimePermission("modifyThread")); }
                @Override public void checkAccess(ThreadGroup group) { checkPermission(new RuntimePermission("modifyThreadGroup")); }
            });
            Map<?,?> spec = (Map<?,?>) new Json(new String(System.in.readAllBytes(), StandardCharsets.UTF_8)).parse();
            response.put("nonce", spec.get("nonce"));
            PrintStream userOutput = new PrintStream(new OutputStream() {
                @Override public void write(int value) {
                    if (capture.size() >= OUTPUT_LIMIT) { overflow[0] = true; throw new IllegalStateException("Вывод превысил 16 КиБ."); }
                    capture.write(value);
                }
                @Override public void write(byte[] bytes, int offset, int length) {
                    if (capture.size() + length > OUTPUT_LIMIT) { overflow[0] = true; throw new IllegalStateException("Вывод превысил 16 КиБ."); }
                    capture.write(bytes, offset, length);
                }
            }, true, StandardCharsets.UTF_8);
            System.setOut(userOutput);
            System.setErr(userOutput);
            List<?> locations = (List<?>) spec.get("classPaths");
            URL[] urls = new URL[locations.size()];
            for (int i=0; i<urls.length; i++) urls[i] = new File((String)locations.get(i)).toURI().toURL();
            try (URLClassLoader studentLoader = new URLClassLoader(urls, ClassLoader.getPlatformClassLoader())) {
                Class<?> solution = Class.forName((String) spec.get("className"), true, studentLoader);
                List<?> parameterNames = (List<?>) spec.get("parameterTypes");
                Class<?>[] parameterTypes = new Class<?>[parameterNames.size()];
                for (int i=0; i<parameterTypes.length; i++) parameterTypes[i] = type((String)parameterNames.get(i), studentLoader);
                Method method = solution.getDeclaredMethod((String)spec.get("method"), parameterTypes);
                method.setAccessible(true);
                Map<?,?> custom = spec.get("customTypes") instanceof Map<?,?> mapping ? mapping : Map.of();
                List<?> inputs = (List<?>) spec.get("args");
                Object[] arguments = new Object[inputs.size()];
                if (arguments.length != parameterTypes.length) throw new IllegalArgumentException("Число аргументов не совпадает.");
                for (int i=0; i<arguments.length; i++) arguments[i] = convert(inputs.get(i), method.getGenericParameterTypes()[i], custom, studentLoader);
                List<Object> before = new ArrayList<>();
                for (Object argument: arguments) before.add(normalize(argument, custom));
                Object instance = null;
                if (!Modifier.isStatic(method.getModifiers())) {
                    Constructor<?> constructor = solution.getDeclaredConstructor();
                    constructor.setAccessible(true);
                    instance = constructor.newInstance();
                }
                Object actual = method.invoke(instance, arguments);
                if (overflow[0]) throw new IllegalStateException("Вывод превысил 16 КиБ.");
                response.put("actual", normalize(actual, custom));
                List<Object> after = new ArrayList<>();
                for (Object argument: arguments) after.add(normalize(argument, custom));
                response.put("before", before);
                response.put("after", after);
                response.put("completed", true);
            }
        } catch (Throwable error) {
            while (error instanceof InvocationTargetException && error.getCause() != null) error = error.getCause();
            response.put("status", "runtime_error");
            String message = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
            response.put("message", message.substring(0, Math.min(message.length(), 2000)));
        }
        response.put("stdout", capture.toString(StandardCharsets.UTF_8));
        try { protocol.print(Json.stringify(response)); protocol.flush(); }
        catch (Throwable error) { protocol.print("{\"status\":\"runtime_error\",\"message\":\"Не удалось сериализовать результат.\"}"); protocol.flush(); }
    }

    private static Class<?> type(String name, ClassLoader loader) throws ClassNotFoundException {
        return switch (name) {
            case "int" -> int.class; case "long" -> long.class; case "double" -> double.class;
            case "float" -> float.class; case "short" -> short.class; case "byte" -> byte.class;
            case "boolean" -> boolean.class; case "char" -> char.class;
            default -> Class.forName(name, true, loader);
        };
    }

    private static Object convert(Object value, Type target, Map<?,?> custom, ClassLoader loader) throws Exception {
        if (target instanceof ParameterizedType parameterized) {
            Class<?> raw = (Class<?>) parameterized.getRawType();
            if (Collection.class.isAssignableFrom(raw)) {
                if (value == null) return null;
                Collection<Object> result = Set.class.isAssignableFrom(raw) ? new LinkedHashSet<>() : new ArrayList<>();
                for (Object item: (List<?>)value) result.add(convert(item, parameterized.getActualTypeArguments()[0], custom, loader));
                return result;
            }
            if (Map.class.isAssignableFrom(raw)) {
                Map<Object,Object> result = new LinkedHashMap<>();
                for (Map.Entry<?,?> entry: ((Map<?,?>)value).entrySet()) result.put(convert(entry.getKey(),parameterized.getActualTypeArguments()[0],custom,loader),convert(entry.getValue(),parameterized.getActualTypeArguments()[1],custom,loader));
                return result;
            }
            target = raw;
        }
        if (target instanceof WildcardType wildcard) return convert(value,wildcard.getUpperBounds()[0],custom,loader);
        if (target instanceof TypeVariable<?>) return value;
        Class<?> kind = (Class<?>)target;
        if (value == null) return null;
        if (kind == Object.class) return value;
        if (kind == String.class) return String.valueOf(value);
        if (kind == int.class || kind == Integer.class) return ((Number)value).intValue();
        if (kind == long.class || kind == Long.class) return ((Number)value).longValue();
        if (kind == double.class || kind == Double.class) return ((Number)value).doubleValue();
        if (kind == float.class || kind == Float.class) return ((Number)value).floatValue();
        if (kind == short.class || kind == Short.class) return ((Number)value).shortValue();
        if (kind == byte.class || kind == Byte.class) return ((Number)value).byteValue();
        if (kind == boolean.class || kind == Boolean.class) return (Boolean)value;
        if (kind == char.class || kind == Character.class) {
            String text = (String)value; if (text.length()!=1) throw new IllegalArgumentException("Ожидается символ."); return text.charAt(0);
        }
        if (kind.isArray()) {
            List<?> items = (List<?>)value; Object result = Array.newInstance(kind.getComponentType(),items.size());
            for (int i=0;i<items.size();i++) Array.set(result,i,convert(items.get(i),kind.getComponentType(),custom,loader));
            return result;
        }
        if (Collection.class.isAssignableFrom(kind)) return new ArrayList<>((List<?>)value);
        if (custom.get(kind.getName()) instanceof Map<?,?> description) {
            List<?> names = (List<?>)description.get("fields"), types = (List<?>)description.get("constructorTypes");
            Class<?>[] parameters = new Class<?>[types.size()]; Object[] arguments = new Object[types.size()];
            for (int i=0;i<types.size();i++) { parameters[i]=type((String)types.get(i),loader); arguments[i]=convert(((Map<?,?>)value).get(names.get(i)),parameters[i],custom,loader); }
            Constructor<?> constructor = kind.getDeclaredConstructor(parameters); constructor.setAccessible(true);
            return constructor.newInstance(arguments);
        }
        throw new IllegalArgumentException("Неподдерживаемый тип аргумента: " + kind.getName());
    }

    private static Object normalize(Object value, Map<?,?> custom) throws Exception {
        return normalize(value,custom,Collections.newSetFromMap(new IdentityHashMap<>()),0);
    }
    private static Number safeNumber(Number value) {
        // Number is extensible: a student subclass must never supply raw JSON via toString().
        Class<?> kind = value.getClass();
        if (kind != Byte.class && kind != Short.class && kind != Integer.class && kind != Long.class && kind != Float.class && kind != Double.class) {
            throw new IllegalArgumentException("Неподдерживаемый числовой тип: " + kind.getName());
        }
        if (kind == Double.class && !Double.isFinite((Double)value) || kind == Float.class && !Float.isFinite((Float)value)) {
            throw new IllegalArgumentException("Числовой результат должен быть конечным.");
        }
        return value;
    }
    private static Object normalize(Object value, Map<?,?> custom, Set<Object> seen, int depth) throws Exception {
        if (depth>50) throw new IllegalArgumentException("Слишком глубокая вложенность результата.");
        if (value==null || value instanceof String || value instanceof Boolean) return value;
        if (value instanceof Number number) return safeNumber(number);
        if (value instanceof Character) return value.toString();
        if (!seen.add(value)) throw new IllegalArgumentException("Цикл в результате.");
        try {
            if (value instanceof Map<?,?> map) {
                if (map.size()>MAX_VALUES) throw new IllegalArgumentException("Слишком большой результат.");
                Map<String,Object> result = new LinkedHashMap<>();
                for (Map.Entry<?,?> entry:map.entrySet()) result.put(String.valueOf(entry.getKey()),normalize(entry.getValue(),custom,seen,depth+1));
                return result;
            }
            if (value instanceof Iterable<?> items) {
                List<Object> result = new ArrayList<>();
                for (Object item:items) { if (result.size()>=MAX_VALUES) throw new IllegalArgumentException("Слишком большой результат."); result.add(normalize(item,custom,seen,depth+1)); }
                return result;
            }
            if (value.getClass().isArray()) {
                int size=Array.getLength(value); if(size>MAX_VALUES) throw new IllegalArgumentException("Слишком большой результат.");
                List<Object> result = new ArrayList<>();
                for (int i=0;i<size;i++) result.add(normalize(Array.get(value,i),custom,seen,depth+1)); return result;
            }
            if (custom.get(value.getClass().getName()) instanceof Map<?,?> description) {
                Map<String,Object> result = new LinkedHashMap<>();
                for (Object name:(List<?>)description.get("fields")) { Field field=value.getClass().getDeclaredField((String)name); field.setAccessible(true); result.put((String)name,normalize(field.get(value),custom,seen,depth+1)); }
                return result;
            }
            throw new IllegalArgumentException("Неподдерживаемый тип результата: " + value.getClass().getName());
        } finally { seen.remove(value); }
    }

    /** Small strict JSON reader/writer; no downloaded libraries. */
    private static final class Json {
        final String text; int pos;
        Json(String text) { this.text=text; }
        Object parse() { Object value=read(0);space();if(pos!=text.length())throw bad();return value; }
        void space() { while(pos<text.length() && Character.isWhitespace(text.charAt(pos)))pos++; }
        IllegalArgumentException bad() { return new IllegalArgumentException("Invalid JSON at offset "+pos); }
        Object read(int depth) {
            if(depth>100) throw new IllegalArgumentException("JSON is nested too deeply.");
            space(); if(pos>=text.length())throw bad(); char c=text.charAt(pos);
            if(c=='"')return string();
            if(c=='[') { pos++;List<Object> values=new ArrayList<>();space();if(take(']'))return values;do{values.add(read(depth+1));space();if(take(']'))return values;}while(take(','));throw bad(); }
            if(c=='{') { pos++;Map<String,Object> values=new LinkedHashMap<>();space();if(take('}'))return values;do{space();String key=string();space();if(!take(':'))throw bad();values.put(key,read(depth+1));space();if(take('}'))return values;}while(take(','));throw bad(); }
            if(text.startsWith("true",pos)){pos+=4;return true;} if(text.startsWith("false",pos)){pos+=5;return false;} if(text.startsWith("null",pos)){pos+=4;return null;}
            int start=pos;while(pos<text.length() && "-+0123456789.eE".indexOf(text.charAt(pos))>=0)pos++;
            String number=text.substring(start,pos);
            try { if(number.contains(".")||number.contains("e")||number.contains("E"))return Double.parseDouble(number);return Long.parseLong(number); }
            catch(NumberFormatException error){throw bad();}
        }
        boolean take(char c){if(pos<text.length() && text.charAt(pos)==c){pos++;return true;}return false;}
        String string() {
            if(!take('"'))throw bad();StringBuilder result=new StringBuilder();
            while(pos<text.length()) {
                char c=text.charAt(pos++);if(c=='"')return result.toString();
                if(c=='\\') { if(pos>=text.length())throw bad();char escaped=text.charAt(pos++);switch(escaped){case '"':case '\\':case '/':result.append(escaped);break;case 'b':result.append('\b');break;case 'f':result.append('\f');break;case 'n':result.append('\n');break;case 'r':result.append('\r');break;case 't':result.append('\t');break;case 'u':if(pos+4>text.length())throw bad();result.append((char)Integer.parseInt(text.substring(pos,pos+4),16));pos+=4;break;default:throw bad();} }
                else {if(c<32)throw bad();result.append(c);}
            }
            throw bad();
        }
        static String stringify(Object value) {
            StringBuilder output=new StringBuilder();write(value,output);return output.toString();
        }
        static void write(Object value,StringBuilder output) {
            if(value==null){output.append("null");return;}
            if(value instanceof Boolean){output.append(value);return;}
            if(value instanceof Number number){
                safeNumber(number);
                // Append only primitive values from the exact final JDK classes checked above.
                if(number.getClass()==Double.class) output.append(number.doubleValue());
                else if(number.getClass()==Float.class) output.append(number.floatValue());
                else output.append(number.longValue());
                return;
            }
            if(value instanceof Map<?,?> map){output.append('{');boolean first=true;for(Map.Entry<?,?> entry:map.entrySet()){if(!first)output.append(',');first=false;write(entry.getKey().toString(),output);output.append(':');write(entry.getValue(),output);}output.append('}');return;}
            if(value instanceof Iterable<?> iterable){output.append('[');boolean first=true;for(Object item:iterable){if(!first)output.append(',');first=false;write(item,output);}output.append(']');return;}
            output.append('"');for(char c:value.toString().toCharArray()){switch(c){case '"':output.append("\\\"");break;case '\\':output.append("\\\\");break;case '\n':output.append("\\n");break;case '\r':output.append("\\r");break;case '\t':output.append("\\t");break;default:if(c<32)output.append(String.format("\\u%04x",(int)c));else output.append(c);}}output.append('"');
        }
    }
}
