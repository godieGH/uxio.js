const express = require('express')
const path = require('path')
const Uxio = require('../')

const app = express()

app.use(Uxio())

app.post('/', async (req, res) => {
   try {
      const file = await Uxio.files.save({
         filename: ["avatar", "File"],
         path: path.join(__dirname, "uploads"),
         makedir: true,
         rename: (file) => {
            return `${Date.now()}${file.filename}`
         }
      }, req.uxio)
      res.json(file)
   } catch (e) {
      res.json(e.message)
   }
})

app.listen(3000)