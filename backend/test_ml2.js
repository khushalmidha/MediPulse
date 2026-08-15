const text = `agent: Hi Kavya Midha. Before your appointment, what is the main health concern you want to discuss today?
patient: Headache, fever, vommitng 8 no fever is high
agent: How long have you had these symptoms?
patient: 8 days
agent: On a scale of 1 to 10, how severe is it right now?
patient: 6
agent: Do you have any relevant medical history or ongoing condition?
patient: no`;

import('axios').then(axios => {
  axios.default.post('http://localhost:8003/predict', { text }).then(res => console.log(res.data)).catch(err => console.error(err.message));
});
