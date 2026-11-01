import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'src/scripts/set_discord_token.py'
spec = importlib.util.spec_from_file_location('set_discord_token', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DiscordTokenSafetyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'config').mkdir()
        (self.root / '.env').write_text('OTHER=keep\nDISCORD_TOKEN=old-token\n', encoding='utf-8')
        (self.root / 'config/.env.byosan').write_text('CHANNEL=byosan\nDISCORD_TOKEN=old-token\n', encoding='utf-8')

    def test_migrates_without_touching_other_keys_and_creates_private_backups(self):
        token = 'a' * 35 + '.' + 'b' * 35
        changed = module.apply_token(self.root, token)
        self.assertEqual(len(changed), 2)
        module.check(self.root)
        self.assertIn('OTHER=keep\n', (self.root / '.env').read_text())
        self.assertNotIn('DISCORD_TOKEN=', (self.root / 'config/.env.byosan').read_text())
        self.assertIn('CHANNEL=byosan', (self.root / 'config/.env.byosan').read_text())
        for path in changed:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            backups = list(path.parent.glob(path.name + '.backup-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o600)

    def test_empty_token_never_writes(self):
        before = (self.root / '.env').read_bytes()
        with self.assertRaises(ValueError):
            module.apply_token(self.root, '')
        self.assertEqual((self.root / '.env').read_bytes(), before)
        self.assertFalse(list(self.root.glob('.env.backup-*')))

    def test_symlink_is_rejected_without_writing(self):
        (self.root / 'config/.env').symlink_to(self.root / '.env')
        with self.assertRaises(ValueError):
            module.apply_token(self.root, 'a' * 35)
        self.assertEqual((self.root / '.env').read_text(), 'OTHER=keep\nDISCORD_TOKEN=old-token\n')
        self.assertFalse(list(self.root.glob('.env.backup-*')))


if __name__ == '__main__':
    unittest.main()
