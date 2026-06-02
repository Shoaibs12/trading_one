const url = `https://api.telegram.org/bot8859478288:AAFDynRw5UReYsVWQlxv-baBQLSr1ZafwdQ/getUpdates?offset=1&timeout=1&allowed_updates=["message"]`;
fetch(url)
  .then(res => res.json())
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.error(err));
