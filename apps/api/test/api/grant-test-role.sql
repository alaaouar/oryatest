-- Le role de test herite exactement des privileges d'orya_app (dont P0-3 : colonnes sensibles de User).
GRANT USAGE ON SCHEMA public TO :"test_role";
GRANT orya_app TO :"test_role";
