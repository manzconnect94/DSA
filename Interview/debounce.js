import React from 'react';
import { useState,useEffect ,useCallback} from 'react'

function App() {
  const [value, setValue] = useState("");

  function debounce(fn, delay) {
    let timer;

    return function (...args) {
      clearTimeout(timer);

      timer = setTimeout(() => fn(...args), delay);
    };
  }

  const search = useCallback(()=> debounce((value) => {
    console.log("API call:", value);
  }, 500), []);
₹
  useEffect(() => {
    search(value);
  }, [value]);

  return (
    <div>
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}

export default App
