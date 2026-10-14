import re
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
GRADLE = (ROOT / "clients/android-tv/app/build.gradle.kts").read_text(encoding="utf-8")


def gradle_version_code(major, minor, patch):
    """Evaluate the formula the Gradle build really uses (single source)."""
    match = re.search(r"fun deriveVersionCode\(major: Int, minor: Int, patch: Int\) =\s*(.+)", GRADLE)
    assert match, "deriveVersionCode not found in app/build.gradle.kts"
    return eval(match.group(1), {}, {"major": major, "minor": minor, "patch": patch})


class AndroidVersionTests(unittest.TestCase):
    def test_version_code_known_values(self):
        self.assertEqual(908, gradle_version_code(0, 9, 8))
        self.assertEqual(10000, gradle_version_code(1, 0, 0))
        self.assertEqual(10203, gradle_version_code(1, 2, 3))

    def test_version_code_increases_with_each_release(self):
        releases = [(0, 9, 8), (0, 9, 9), (0, 10, 0), (1, 0, 0), (1, 0, 1), (1, 1, 0), (2, 0, 0)]
        codes = [gradle_version_code(*r) for r in releases]
        self.assertEqual(codes, sorted(set(codes)))

    def test_gradle_reads_root_version_and_does_not_hardcode(self):
        self.assertIn('"../../../VERSION"', GRADLE)
        self.assertNotRegex(GRADLE, r"versionCode\s*=\s*\d")
        self.assertNotRegex(GRADLE, r'versionName\s*=\s*"')

    def test_build_rejects_components_that_break_monotonicity(self):
        self.assertIn("require(verMinor < 100 && verPatch < 100", GRADLE)

    def test_release_signing_uses_env_with_debug_fallback_and_warning(self):
        for name in ("TORRENTTV_KEYSTORE_PATH", "TORRENTTV_KEYSTORE_PASSWORD",
                     "TORRENTTV_KEY_ALIAS", "TORRENTTV_KEY_PASSWORD"):
            self.assertIn(name, GRADLE)
        self.assertIn('signingConfigs.getByName("debug")', GRADLE)
        self.assertIn("WARNING", GRADLE)


if __name__ == "__main__":
    unittest.main()
