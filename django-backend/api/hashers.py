import bcrypt
from django.contrib.auth.hashers import BCryptPasswordHasher

class LaravelBCryptPasswordHasher(BCryptPasswordHasher):
    algorithm = "2y"

    def verify(self, password, encoded):
        encoded_compat = encoded
        if encoded.startswith('$2y$'):
            encoded_compat = '$2b$' + encoded[4:]
        
        if encoded_compat.startswith(('$2a$', '$2b$', '$2y$')):
            try:
                return bcrypt.checkpw(password.encode('utf-8'), encoded_compat.encode('utf-8'))
            except Exception:
                pass
        return super().verify(password, encoded)


class Laravel2aPasswordHasher(LaravelBCryptPasswordHasher):
    algorithm = "2a"
