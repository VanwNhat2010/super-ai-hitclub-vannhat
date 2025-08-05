const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(cors());

app.get('/taixiu', async (req, res) => {
  try {
    const response = await axios.get('https://binhtool90-hitclub-predict.onrender.com/api/taixiu');
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching data from API:', error);
    res.status(500).send('Error fetching data');
  }
});

app.listen(port, () => {
  console.log(`CORS Proxy server listening at http://localhost:${port}`);
});
