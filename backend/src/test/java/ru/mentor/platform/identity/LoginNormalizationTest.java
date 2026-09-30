package ru.mentor.platform.identity;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LoginNormalizationTest {
    @Test void appliesNfkcAndLegacyJavascriptWhitespaceTrimming() {
        assertEquals("admin",assertDoesNotThrow(() -> AuthService.normalizeLogin("\uFEFFＡＤＭＩＮ\uFEFF")));
        assertEquals("admin",AuthService.normalizeLogin("\u00A0Admin\u2028"));
    }
    @Test void doesNotSilentlyAcceptAsciiSeparatorsThatLegacyTrimPreserved() {
        assertThrows(IllegalArgumentException.class,() -> AuthService.normalizeLogin("\u001Cadmin\u001C"));
    }
}
