package com.houseofbeauty.controller.common;

import jakarta.persistence.EntityNotFoundException;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;

import java.util.List;

public abstract class BaseCrudController<T, ID> {

    protected final JpaRepository<T, ID> repository;

    protected BaseCrudController(JpaRepository<T, ID> repository) {
        this.repository = repository;
    }

    @GetMapping
    public List<T> findAll() {
        return repository.findAll();
    }

    @GetMapping("/{id}")
    public T findById(@PathVariable ID id) {
        return repository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Not found: " + id));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public T create(@RequestBody T entity) {
        return repository.save(entity);
    }

    @PutMapping("/{id}")
    public T update(@PathVariable ID id, @RequestBody T entity) {
        if (!repository.existsById(id)) {
            throw new EntityNotFoundException("Not found: " + id);
        }
        return repository.save(entity);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable ID id) {
        if (!repository.existsById(id)) {
            throw new EntityNotFoundException("Not found: " + id);
        }
        repository.deleteById(id);
    }
}
