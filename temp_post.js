const axios = require('axios');
const fs = require('fs');
(async () => {
  try {
    const body = JSON.parse(fs.readFileSync('./temp_body.json', 'utf8'));
    const res = await axios.post('http://localhost:3001/send-alert', body, { timeout: 15000 });
    console.log('RESPONSE:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    if (e.response) {
      console.error('ERROR_RESPONSE:', e.response.status, JSON.stringify(e.response.data));
      process.exit(1);
    }
    console.error('ERROR:', e.message || e);
    process.exit(1);
  }
})();
